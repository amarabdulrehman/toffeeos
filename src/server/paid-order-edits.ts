import "server-only";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { publish } from "@/server/realtime";
import { getBranchPricingContext, pricingLinesFromStored } from "@/server/orders";
import { finalizeOrder, type DiscountInput, type PaymentMethodKey } from "@/lib/pricing";
import { businessDayOf } from "@/lib/business-day";
import { earnForPaidOrder, reverseForRefund } from "@/server/loyalty-ledger";

/**
 * What can change on an order after it is paid.
 *
 * Only the record, never the money in place. A paid bill is already in the drawer, the day's
 * takings and the tax figures; letting its items, prices or amounts be edited would make last
 * night's closing slip disagree with today's screen, and would let a till take cash and quietly
 * edit the bill down. Anything that changes what was charged goes through a refund. What is here:
 *
 * - **Correcting the payment method**, the commonest till slip (Cash pressed for a card). It
 *   matters twice over: the drawer expects cash that isn't there, and tax depends on the method
 *   (a branch can tax cash and card at different rates), so the bill is priced again at the right
 *   method and the difference is said out loud — give back, or collect.
 * - **Adding the customer** after the fact ("add my number for points"), which changes no money.
 *
 * Every change needs a reason (the customer one excepted: it is self-explanatory) and lands on the
 * order's history.
 */

async function loadPaid(tenantId: string, branchId: string, orderId: string) {
  const order = await tenantDb(tenantId).order.findFirst({
    where: { id: orderId, branchId },
    include: { lines: true, discounts: true, payments: true },
  });
  if (!order) throw new HttpError(404, "That order doesn't exist at this branch.");
  if (order.status !== "PAID" && !(order.status === "DELIVERED" && order.paidAt)) {
    throw new HttpError(409, `Order #${order.orderNumber} isn't paid, so there's nothing to correct. Change it before payment instead.`);
  }
  return order;
}

const CORRECTABLE: PaymentMethodKey[] = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"];

/**
 * Re-records how a paid bill was paid, priced again at that method's tax rate.
 *
 * The payment row is corrected in place, and the before and after go on the order's history. In
 * place, so every report, the drawer and the closing slip agree with the correction without each
 * learning about it; the history keeps what it was.
 *
 * Who may: anyone with pos.payment.correct, for an order paid today while that day's drawer is
 * open — a cashier fixing their own slip. An earlier day, or a drawer already counted, changes a
 * figure someone has signed off, so it also needs pos.cashDrawer.correctClose (owners and branch
 * managers, by default), the permission that already corrects a closed drawer.
 *
 * Not yet: bills split across methods, and bills with refunds — both are ambiguous about which
 * money moved, and a guess there is worse than a refund and a fresh payment.
 */
export async function correctPaymentMethod(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { orderId: string; method: PaymentMethodKey; reason: string },
  mayCorrectClosedDay: boolean
) {
  const reason = input.reason.trim();
  if (reason.length < 2) throw new HttpError(400, "Say why the payment method is being changed.");
  if (!CORRECTABLE.includes(input.method)) throw new HttpError(400, "That isn't a way of paying the till takes.");

  const order = await loadPaid(tenantId, branchId, input.orderId);
  if (order.payments.length !== 1) {
    throw new HttpError(409, "This bill was split across payment methods, which can't be corrected here yet. Refund it and take payment again.");
  }
  if (order.refundedPaisa > 0) {
    throw new HttpError(409, "This bill has refunds against it, so its payment method can't be changed. Refund the rest and take payment again.");
  }
  const payment = order.payments[0];
  if (payment.method === input.method) throw new HttpError(400, "That's already how it was paid.");

  // The drawer day it was paid on, and whether that day is still open.
  const branch = await tenantDb(tenantId).branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { timezone: true, settings: { select: { dayStartMinutes: true } } },
  });
  const dayStart = branch.settings?.dayStartMinutes ?? 0;
  const paidDay = businessDayOf(order.paidAt!, branch.timezone, dayStart);
  const today = businessDayOf(new Date(), branch.timezone, dayStart);
  const drawer = await tenantDb(tenantId).cashDrawerDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: paidDay } },
    select: { closedAt: true },
  });
  if (!mayCorrectClosedDay && (paidDay !== today || drawer?.closedAt)) {
    throw new HttpError(
      403,
      paidDay !== today
        ? "That bill is from an earlier day. A manager can correct it."
        : "Today's drawer has already been counted. A manager can correct it."
    );
  }

  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, order.type, order.taxExemptReason !== null);
  const discount: DiscountInput | undefined = order.discounts[0]
    ? { type: order.discounts[0].type, value: order.discounts[0].value }
    : undefined;
  // One tender, so its weight doesn't matter: the whole taxable base goes at this method's rate.
  const totals = finalizeOrder(pricingLinesFromStored(order.lines), discount, taxRules, settings, [{ method: input.method, amountPaisa: 1 }]);
  const differencePaisa = totals.totalPaisa - order.totalPaisa;

  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { version: true } });
    if (fresh.version !== order.version) throw new HttpError(409, `Order #${order.orderNumber} was just changed on another screen. Open it again and retry.`);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        method: input.method,
        amountPaisa: totals.totalPaisa,
        taxRateBasisPoints: totals.tenders[0].rateBasisPoints,
        // Cash handed over and change given belong to a cash payment only, and aren't known for a
        // corrected one.
        tenderedPaisa: null,
        changePaisa: null,
      },
    });
    const saved = await tx.order.update({
      where: { id: order.id },
      data: {
        taxPaisa: totals.taxPaisa,
        roundingAdjustmentPaisa: totals.roundingAdjustmentPaisa,
        totalPaisa: totals.totalPaisa,
        paidPaisa: totals.totalPaisa,
        version: { increment: 1 },
      },
    });
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId: order.id,
        type: "PAYMENT_CORRECTED",
        actorId,
        payload: {
          from: payment.method,
          to: input.method,
          oldTotalPaisa: order.totalPaisa,
          newTotalPaisa: totals.totalPaisa,
          differencePaisa,
          paidDay,
          drawerClosed: Boolean(drawer?.closedAt),
          reason,
        },
      },
    });
    return saved;
  });

  await publish(tenantId, branchId, "orders", "order_updated", { orderId: order.id });
  return { order: updated, from: payment.method, to: input.method, oldTotalPaisa: order.totalPaisa, differencePaisa };
}

/**
 * Puts a customer on a bill that was paid without one, and gives them the points it earned. Only
 * when there was nobody on it: moving a bill from one customer to another would move loyalty
 * points between people, which is a different and much less innocent thing.
 */
export async function attachCustomerAfterPayment(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { orderId: string; customerId: string }
) {
  const order = await loadPaid(tenantId, branchId, input.orderId);
  if (order.customerId) throw new HttpError(409, "This bill already has a customer on it.");
  const customer = await tenantDb(tenantId).customer.findFirst({ where: { id: input.customerId }, select: { id: true, name: true, phone: true } });
  if (!customer) throw new HttpError(404, "That customer doesn't exist.");

  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, customerId: null },
      data: { customerId: customer.id, version: { increment: 1 } },
    });
    if (claimed.count === 0) throw new HttpError(409, "Someone else just added a customer to this bill.");
    const saved = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    // Earned as if they'd been on it at the till, less whatever has since been refunded.
    await earnForPaidOrder(tx, tenantId, saved, actorId);
    if (saved.refundedPaisa > 0) await reverseForRefund(tx, tenantId, saved, actorId);
    await tx.orderEvent.create({
      data: { tenantId, orderId: order.id, type: "CUSTOMER_ADDED", actorId, payload: { customerId: customer.id, name: customer.name, phone: customer.phone } },
    });
    return saved;
  });

  await publish(tenantId, branchId, "orders", "order_updated", { orderId: order.id });
  return { order: updated, customer };
}
