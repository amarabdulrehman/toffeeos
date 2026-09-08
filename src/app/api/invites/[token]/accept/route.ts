import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { acceptInvite } from "@/server/staff-invites";
import { HttpError } from "@/server/handler";

const schema = z.object({
  name: z.string().min(2).max(120),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Public, unauthenticated — same reasoning as /api/signup: the account doesn't exist yet, so there
// is no session to gate this behind.
export async function POST(req: NextRequest, routeCtx: { params: Promise<{ token: string }> }) {
  const { token } = await routeCtx.params;
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await acceptInvite(token, parsed.data);
    if (!result) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 410 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Unauthenticated endpoint — a raw Prisma error here would hand an anonymous caller the model
    // name, operation and constraint columns (e.g. a duplicate-email unique violation). Only the
    // deliberate HttpError messages are safe to forward; see /api/signup for the same split.
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    Sentry.captureException(err);
    console.error(err);
    return NextResponse.json({ error: "Could not accept invite." }, { status: 400 });
  }
}
