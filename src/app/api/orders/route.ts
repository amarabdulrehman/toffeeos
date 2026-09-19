import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { assertDiscountPermission, createOrder } from "@/server/orders";

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
    // Line add-ons come along because the receipt has to explain its own prices: a latte with an
    // extra shot is charged at Rs 600 against a menu board that says Rs 500, and a receipt that
    // cannot say why is a dispute. Bounded by the take above, same join the kitchen board uses.
    include: { lines: { include: { modifiers: true } }, table: true, payments: true },
  });
  return { orders };
});

// POST /api/orders — punch a new order. Returns provisional totals (cash-rate estimate); the
// authoritative total is computed at payment time by POST /api/orders/[orderId]/pay.
export const POST = defineHandler(
  { permission: "pos.order.create", input: createOrderSchema },
  async ({ session, input }) => {
    assertDiscountPermission(session, input.orderDiscount, input.lines);
    // The branch's discount ceiling is enforced inside createOrder, where the real line prices
    // exist; whether this cashier may go past it is a property of their session, so it is read
    // here and never from the request body.
    const order = await createOrder(
      session.tenantId,
      session.branchId,
      session.id,
      input,
      session.permissions.includes("pos.discount.exceedMax")
    );
    return { order };
  }
);
