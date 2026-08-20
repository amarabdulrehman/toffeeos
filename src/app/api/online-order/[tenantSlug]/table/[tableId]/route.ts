import { NextRequest, NextResponse } from "next/server";
import { getStorefront, getTableInfo } from "@/server/online-ordering";

type RouteContext = { params: Promise<{ tenantSlug: string; tableId: string }> };

// GET /api/online-order/[tenantSlug]/table/[tableId] — public, resolves a scanned table QR to
// its label/branch so the ordering page can lock itself to that table.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { tenantSlug, tableId } = await ctx.params;
  const storefront = await getStorefront(tenantSlug);
  if (!storefront) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const table = await getTableInfo(storefront.tenantId, tableId);
  if (!table) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(table);
}
