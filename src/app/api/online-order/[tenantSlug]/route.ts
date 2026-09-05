import { NextRequest, NextResponse } from "next/server";
import { getStorefront } from "@/server/online-ordering";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

// GET /api/online-order/[tenantSlug] — public, unauthenticated storefront info (name, branding,
// branch list). Returns 404 for an unknown or suspended/cancelled tenant, same as login's gate.
// Generous limit (unlike the 5/5min on checkout) since normal browsing/reloading hits this often —
// this just stops unthrottled scraping/enumeration, the one gap the write endpoints didn't have.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { tenantSlug } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`online-order-view:${tenantSlug}:${ip}`, 60, 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests — please slow down." }, { status: 429 });
  }
  const storefront = await getStorefront(tenantSlug);
  if (!storefront) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(storefront);
}
