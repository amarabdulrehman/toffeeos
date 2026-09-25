import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { getBranchPricingContext, pricingLinesFromStored } from "@/server/orders";
import { finalizeOrder, priceLines, type DiscountInput, type PaymentMethodKey } from "@/lib/pricing";
import type { BillOption, OrderBill } from "@/lib/bill";

/**
 * A bill for an order that has not been paid yet — the slip handed to a table that asks for it.
 *
 * The one difficulty is that an unpaid order does not have a single total. Tax depends on how it is
 * paid: Punjab's PRA charges 16% on cash and 8% on card, and a branch can set its own rate for any
 * method. The total stored on the order is only a provisional cash-rate estimate, so printing that
 * would tell a customer paying by card the wrong price.
 *
 * So the bill is priced once per payment method, through the same finalizeOrder pass that
 * takePayment charges with, and methods that come out the same are grouped. A branch with one rate
 * for everything gets one total; a branch with PRA's split gets "cash" and "card and the rest". The
 * figures are exactly what payment will charge, by construction rather than by keeping two
 * calculations in step.
 */

/** Every method a customer might pay with. OTHER is left out: it has no meaning to a customer. */
const BILL_METHODS: PaymentMethodKey[] = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"];

export async function getOrderBill(tenantId: string, branchId: string, orderId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.findFirst({
    where: { id: orderId, branchId },
    include: {
      lines: { include: { modifiers: true } },
      discounts: true,
      table: true,
      payments: true,
    },
  });
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.status === "VOIDED" || order.status === "CANCELLED") {
    throw new HttpError(400, "This order was voided, so there is nothing to bill.");
  }

  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, order.type, order.taxExemptReason !== null);
  const lines = pricingLinesFromStored(order.lines);
  const orderDiscount: DiscountInput | undefined = order.discounts[0]
    ? { type: order.discounts[0].type, value: order.discounts[0].value }
    : undefined;

  const priced = BILL_METHODS.map((method) => ({
    method,
    // A single tender with no amount yet takes the whole taxable base, which is precisely "if the
    // whole bill were paid this way".
    totals: finalizeOrder(lines, orderDiscount, taxRules, settings, [{ method, amountPaisa: 0 }]),
  }));

  const groups = new Map<string, BillOption>();
  for (const { method, totals } of priced) {
    const key = `${totals.totalPaisa}:${totals.taxPaisa}`;
    const existing = groups.get(key);
    if (existing) {
      existing.methods.push(method);
      continue;
    }
    const rateBasisPoints = totals.tenders[0]?.rateBasisPoints ?? 0;
    groups.set(key, {
      methods: [method],
      taxPaisa: totals.taxPaisa,
      taxRatePct: Math.round(rateBasisPoints / 100),
      roundingAdjustmentPaisa: totals.roundingAdjustmentPaisa,
      totalPaisa: totals.totalPaisa,
    });
  }

  // Everything above tax is the same whichever way the bill is paid.
  const first = priced[0].totals;
  // The engine's subtotal is already net of line discounts, while each printed line shows its full
  // price. Printing that subtotal under those lines would give a bill whose lines do not add up to
  // it. So the bill shows the lines' own sum, and every discount — per line and on the order — as
  // one figure beneath it.
  const { results } = priceLines(lines);
  const grossPaisa = results.reduce((sum, r) => sum + r.grossPaisa, 0);
  const bill: OrderBill = {
    subtotalPaisa: grossPaisa,
    discountPaisa: grossPaisa - first.discountedSubtotalPaisa,
    serviceChargePaisa: first.serviceChargePaisa,
    deliveryFeePaisa: first.deliveryFeePaisa,
    options: [...groups.values()].sort((a, b) => a.totalPaisa - b.totalPaisa),
  };

  // Voided lines are not part of what the table owes, so they are not on its bill.
  return { order: { ...order, lines: order.lines.filter((l) => !l.isVoided) }, bill };
}
