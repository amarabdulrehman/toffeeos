import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emailInput, slugInput } from "@/lib/identity";
import { requestTenantPasswordReset } from "@/server/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

// Public, unauthenticated. Always returns the same generic message regardless of whether the
// tenant/email combination actually has an account — the whole point is that this can't be used to
// enumerate who has one.
const schema = z.object({
  tenantSlug: slugInput(),
  email: emailInput(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`password-reset-request:${ip}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests — please wait a while and try again." }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await requestTenantPasswordReset(parsed.data.tenantSlug, parsed.data.email);
  return NextResponse.json({ message: "If that account exists, we've sent a password reset link to its email." });
}
