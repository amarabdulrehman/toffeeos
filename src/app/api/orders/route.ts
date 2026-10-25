import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { assertDiscountPermission, createOrder } from "@/server/orders";
import { branchTodayStart } from "@/server/branch-settings";

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

// GET /api/orders — the Order Queue: open-ish orders for this branch, most recent first.
const listSchema = z.object({
  /**
   * "today": the Order Queue's view — this business day's orders only, so yesterday's paid bills
   * don't crowd today's. Anything from an earlier day still unpaid comes back separately as
   * `earlierUnpaid`, because hiding it outright is how a bill goes uncollected: a table seated at
   * 11:30pm is still eating at 12:15, in a branch whose day starts at midnight.
   *
   * Omitted: every recent order, as before — other screens use this to find an order by id.
   */
  day: z.literal("today").optional(),
});

// Line add-ons come along because the receipt has to explain its own prices: a latte with an extra
// shot is charged at Rs 600 against a menu board that says Rs 500, and a receipt that cannot say why
// is a dispute. Bounded by each query's take, same join the kitchen board uses.
// `discounts` is here so the till can re-price an order in the browser with the connection down:
// finalizeOrder needs the order-level discount, and leaving it out priced an offline card at the
// undiscounted total.
const LIST_INCLUDE = {
  lines: { include: { modifiers: true } },
  table: true,
  payments: true,
  discounts: true,
  // Who it's for, so a bill paid without a customer can be given one afterwards (see the queue's
  // Edit on a paid order) and one that has a customer says so.
  customer: { select: { id: true, name: true, phone: true, loyaltyPoints: true } },
} as const;

export const GET = defineHandler({ permission: "orders.view", input: listSchema }, async ({ session, db, input }) => {
  const notClosed = { notIn: ["VOIDED", "CANCELLED", "DELETED"] as ("VOIDED" | "CANCELLED" | "DELETED")[] };
  if (input.day !== "today") {
    const orders = await db.order.findMany({
      where: { branchId: session.branchId, status: notClosed },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: LIST_INCLUDE,
    });
    return { orders };
  }

  const dayStart = await branchTodayStart(session.tenantId, session.branchId);
  const [orders, earlierUnpaid] = await Promise.all([
    db.order.findMany({
      where: { branchId: session.branchId, status: notClosed, createdAt: { gte: dayStart } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: LIST_INCLUDE,
    }),
    db.order.findMany({
      where: {
        branchId: session.branchId,
        createdAt: { lt: dayStart },
        OR: [
          { status: { in: ["OPEN", "SENT_TO_KITCHEN", "READY", "SERVED"] } },
          // Cash on delivery, delivered, the rider's cash not yet handed in.
          { status: "DELIVERED", paidAt: null },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: LIST_INCLUDE,
    }),
  ]);
  return { orders, earlierUnpaid };
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
