import { defineHandler, HttpError } from "@/server/handler";
import { getBranchPricingContext, pricingLinesFromStored, takePayment } from "@/server/orders";
import { finalizeOrder, type DiscountInput } from "@/lib/pricing";

// POST /api/orders/[orderId]/settle-delivery — the rider is back with the cash for a
// cash-on-delivery order: record it as paid, in cash, in full.
//
// orders.markPaid, which the Cashier role holds: it is the counter taking the rider's cash. It goes
// through takePayment like any payment, so the sale lands in the takings, the drawer and the stock
// exactly as a sale at the till would — this only saves the cashier finding the order and typing
// the amount. Priced the way payment prices it (a cash tender, the whole bill), so the figure
// recorded is the figure the customer was charged at the door.
export const POST = defineHandler(
  {
    permission: "orders.markPaid",
    audit: (_input, result) => ({
      action: "order.delivery.settle",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
    }),
  },
  async ({ session, db, params }) => {
    const order = await db.order.findFirst({
      where: { id: params.orderId, branchId: session.branchId },
      include: { lines: true, discounts: true },
    });
    if (!order) throw new HttpError(404, "That order doesn't exist.");
    if (order.type !== "DELIVERY") throw new HttpError(400, "Only delivery orders are settled this way.");
    if (order.paidAt) throw new HttpError(409, `Order #${order.orderNumber} is already paid.`);
    if (order.status !== "DELIVERED") {
      throw new HttpError(409, `Order #${order.orderNumber} hasn't been delivered yet. Take payment at the till instead.`);
    }

    const { settings, taxRules } = await getBranchPricingContext(
      session.tenantId,
      session.branchId,
      order.type,
      order.taxExemptReason !== null
    );
    const discount: DiscountInput | undefined = order.discounts[0]
      ? { type: order.discounts[0].type, value: order.discounts[0].value }
      : undefined;
    const due = finalizeOrder(pricingLinesFromStored(order.lines), discount, taxRules, settings, [
      { method: "CASH", amountPaisa: 0 },
    ]).totalPaisa;

    const paid = await takePayment(session.tenantId, session.branchId, order.id, session.id, {
      tenders: [{ method: "CASH", amountPaisa: due }],
    });
    return { order: paid };
  }
);
