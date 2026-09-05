import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { platformDb } from "@/server/db";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

// Public, unauthenticated — called by the platform login page right after password entry, so it
// can show a TOTP field only when the account actually has one, without a full page reload.
// Deliberately checks the password itself (not just "does this email have 2FA") and shares the
// exact rate-limit key auth/config.ts's authorize() uses for this account, so this can't be used
// as a side channel to hammer the password separately from the real sign-in attempt limit.
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  if (!(await checkRateLimit(`platform-login:${email}`, 8, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts — please wait a while and try again." }, { status: 429 });
  }

  const platformUser = await platformDb.platformUser.findUnique({ where: { email } });
  if (!platformUser || !(await verifyPassword(password, platformUser.passwordHash))) {
    // Same generic outcome either way — this endpoint never confirms whether an account exists.
    return NextResponse.json({ requiresTotp: false });
  }

  return NextResponse.json({ requiresTotp: platformUser.totpEnabled });
}
