import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findTenantBySlug, tenantAcceptsLogin } from "@/server/auth/session-user";
import { issueOtp } from "@/server/auth/otp-store";

// Public, unauthenticated — triggers the "otp" Auth.js provider's code (src/server/auth/config.ts).
// Used by the rider login page today; the same endpoint works for any phone-based staff login.
// Always returns { ok: true } regardless of whether the phone matches a real user, so this can't
// be used to enumerate who has an account.
const schema = z.object({
  tenantSlug: z.string().min(1),
  phone: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const tenant = await findTenantBySlug(parsed.data.tenantSlug);
  if (tenant && tenantAcceptsLogin(tenant.status)) {
    issueOtp(`${tenant.id}:${parsed.data.phone}`);
  }

  return NextResponse.json({ ok: true });
}
