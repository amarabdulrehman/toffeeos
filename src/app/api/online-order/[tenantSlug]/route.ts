import { NextRequest, NextResponse } from "next/server";
import { getStorefront } from "@/server/online-ordering";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

// GET /api/online-order/[tenantSlug] — public, unauthenticated storefront info (name, branding,
// branch list). Returns 404 for an unknown or suspended/cancelled tenant, same as login's gate.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { tenantSlug } = await ctx.params;
  const storefront = await getStorefront(tenantSlug);
  if (!storefront) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(storefront);
}
