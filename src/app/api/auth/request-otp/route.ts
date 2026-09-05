import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findTenantBySlug, tenantAcceptsLogin } from "@/server/auth/session-user";
import { issueOtp } from "@/server/auth/otp-store";
import { checkRateLimit } from "@/lib/rate-limit";

// Public, unauthenticated — triggers the "otp" Auth.js provider's code (src/server/auth/config.ts).
// Used by the rider login page today; the same endpoint works for any phone-based staff login.
// Always returns { ok: true } regardless of whether the phone matches a real user, so this can't
// be used to enumerate who has an account.
const schema = z.object({
  tenantSlug: z.string().min(1),
  phone: z.string().min(1),
});

export async function POST(req: NextRequest) {
  // Was completely unrated-limited — a public, unauthenticated endpoint that accepts an arbitrary
  // phone number and unconditionally issues an OTP for it. Today that's just an unbounded OtpCode
  // row per request (still a real DB-flooding vector); the moment real SMS/WhatsApp OTP delivery is
  // wired up, the same gap becomes a per-message cost-abuse vector against any phone number an
  // attacker chooses. Same convention as every other public auth route in this app.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`otp-request:${ip}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests — please wait a while and try again." }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const tenant = await findTenantBySlug(parsed.data.tenantSlug);
  if (tenant && tenantAcceptsLogin(tenant.status)) {
    await issueOtp(`${tenant.id}:${parsed.data.phone}`);
  }

  return NextResponse.json({ ok: true });
}
