import { NextRequest, NextResponse } from "next/server";
import { findTenantBySlug } from "@/server/auth/session-user";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/tenants/[slug]/status — unauthenticated, on purpose: the login page uses this to tell
// "wrong password" apart from "this account is suspended, contact support" without needing
// NextAuth's generic CredentialsSignin error to carry a reason. Reveals only the lifecycle status
// of a slug that's already public (it's in the tenant's own login URL) — no PII.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const tenant = await findTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ status: null });
  return NextResponse.json({ status: tenant.status });
}
