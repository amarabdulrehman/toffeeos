import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStorefront, getPublicMenu } from "@/server/online-ordering";

type RouteContext = { params: Promise<{ tenantSlug: string }> };
const querySchema = z.object({ branchId: z.string().min(1) });

// GET /api/online-order/[tenantSlug]/menu?branchId=... — public, live availability/pricing,
// identical data source to the POS product grid (see getPublicMenu's doc comment).
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { tenantSlug } = await ctx.params;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: "branchId is required" }, { status: 400 });

  const storefront = await getStorefront(tenantSlug);
  if (!storefront) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!storefront.branches.some((b) => b.id === parsed.data.branchId)) {
    return NextResponse.json({ error: "Unknown branch" }, { status: 404 });
  }

  const categories = await getPublicMenu(storefront.tenantId, parsed.data.branchId);
  return NextResponse.json({ categories });
}
