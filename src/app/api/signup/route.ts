import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { signupTenant } from "@/server/tenant-signup";
import { HttpError } from "@/server/handler";
import { checkRateLimit } from "@/lib/rate-limit";

// Public, unauthenticated — this is the one route that legitimately creates a Tenant. No session
// exists yet, so it does not go through defineHandler (which requires one). This makes it the other
// public write endpoint in the app besides online-order checkout, and the same class of target: a
// script that keeps generating a new slug/email can otherwise farm unlimited free trials, and — per
// the manual-billing model — a trial's expiry only ever flags it in the admin panel rather than
// blocking access, so an unrate-limited signup was a genuinely free, self-renewing resource. Same
// rate-limit pattern as src/app/api/online-order/[tenantSlug]/checkout/route.ts.
const signupSchema = z.object({
  restaurantName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters"),
  branchName: z.string().min(2).max(120),
  city: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`signup:${ip}`, 3, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many signup attempts from this connection — please wait a while and try again." }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await signupTenant(parsed.data);
    // A fixed body, not the provisioned ids. The response has to be byte-identical whether an
    // account was created or the email was already in use — returning tenantId/slug here would
    // reinstate the enumeration oracle the server-side branch exists to remove. Nothing consumes
    // them anyway now that signup no longer auto-signs-in.
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    // Only messages this code deliberately wrote for a human reach the caller. Anything else — a
    // Prisma constraint violation, a connection failure, an unseeded-plan deployment error — names
    // tables, columns and internals, and this endpoint is unauthenticated, so it goes to Sentry and
    // the caller gets a flat failure. Same split defineHandler makes for authenticated routes.
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    Sentry.captureException(err);
    console.error(err);
    return NextResponse.json({ error: "Could not create the account. Please try again." }, { status: 400 });
  }
}
