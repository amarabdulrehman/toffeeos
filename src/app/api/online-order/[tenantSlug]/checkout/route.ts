import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStorefront, placeOnlineOrder } from "@/server/online-ordering";
import { HttpError } from "@/server/handler";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

const lineSchema = z.object({
  menuItemId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  modifierIds: z.array(z.string().min(1)).optional(),
  quantity: z.number().int().positive().max(50),
  notes: z.string().max(280).optional(),
});

const bodySchema = z.object({
  branchId: z.string().min(1),
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().min(6).max(20),
  fulfillment: z.enum(["PICKUP", "DELIVERY"]),
  deliveryAddress: z.string().max(400).optional(),
  lines: z.array(lineSchema).min(1),
  idempotencyKey: z.string().min(1),
});

// POST /api/online-order/[tenantSlug]/checkout — public, unauthenticated. No online payment (per
// the Phase 4 scoping decision): this places and sends the order to the kitchen; tender happens
// at pickup/delivery like any phone-in order. Rate-limited by IP since this is the one public
// write endpoint in the whole app.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { tenantSlug } = await ctx.params;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`checkout:${tenantSlug}:${ip}`, 5, 5 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many orders from this connection — please wait a few minutes and try again." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order", issues: parsed.error.issues }, { status: 400 });

  const storefront = await getStorefront(tenantSlug);
  if (!storefront) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!storefront.branches.some((b) => b.id === parsed.data.branchId)) {
    return NextResponse.json({ error: "Unknown branch" }, { status: 404 });
  }

  try {
    const order = await placeOnlineOrder(storefront.tenantId, parsed.data);
    return NextResponse.json({ order: { id: order.id, orderNumber: order.orderNumber, totalPaisa: order.totalPaisa } });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Could not place order" }, { status: 500 });
  }
}
