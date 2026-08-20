import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createOrder } from "@/server/orders";

const discountSchema = z.object({ type: z.enum(["PERCENT", "FIXED"]), value: z.number().int().nonnegative() });

const lineSchema = z.object({
  menuItemId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  modifierIds: z.array(z.string().min(1)).optional(),
  quantity: z.number().int().positive(),
  notes: z.string().max(280).optional(),
  discount: discountSchema.optional(),
});

const createOrderSchema = z.object({
  // Client-generated (src/lib/ids.ts newOrderId()) so the offline POS knows the order's final id
  // before it ever reaches the network — see the note on CreateOrderInput in src/server/orders.ts.
  id: z.string().min(1).optional(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "SERVICE"]),
  tableId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  lines: z.array(lineSchema).min(1),
  orderDiscount: discountSchema.optional(),
  idempotencyKey: z.string().min(1),
  deliveryAddress: z.string().max(400).optional(),
});

// GET /api/orders — the Order Queue: every open-ish order for this branch, most recent first.
export const GET = defineHandler({ permission: "orders.view" }, async ({ session, db }) => {
  const orders = await db.order.findMany({
    where: { branchId: session.branchId, status: { notIn: ["VOIDED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { lines: true, table: true, payments: true },
  });
  return { orders };
});

// POST /api/orders — punch a new order. Returns provisional totals (cash-rate estimate); the
// authoritative total is computed at payment time by POST /api/orders/[orderId]/pay.
export const POST = defineHandler(
  { permission: "pos.order.create", input: createOrderSchema },
  async ({ session, input }) => {
    const order = await createOrder(session.tenantId, session.branchId, session.id, input);
    return { order };
  }
);
