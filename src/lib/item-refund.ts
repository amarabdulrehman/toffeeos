import { priceLines, pricingLinesFromStored } from "@/lib/pricing";

export interface RefundableLine {
  id: string;
  nameSnapshot: string;
  unitPricePaisa: number;
  quantity: number;
  isVoided: boolean;
  isComplimentary: boolean;
  refundedQuantity: number;
  discountType: "PERCENT" | "FIXED" | null;
  discountValue: number | null;
}

/**
 * What a set of items is worth out of what was actually paid. Shared by the refund dialog (to show
 * the amount before anyone presses Refund) and the server (which decides it), so they can't differ.
 *
 * Each item's share is its own price after its line discount, as a fraction of the order's
 * line-discounted subtotal; that fraction of the money paid is what goes back. The order discount,
 * service charge, tax and rounding are therefore shared out in proportion, the same way they were
 * charged: refunding one of two equal coffees gives back exactly half the bill. Refunding the last
 * of everything gives back whatever is left, so rounding never strands a paisa.
 */
export function itemRefundAmount(
  order: { paidPaisa: number; refundedPaisa: number },
  lines: RefundableLine[],
  items: { lineId: string; quantity: number }[]
): { ok: true; amountPaisa: number; described: string } | { ok: false; error: string } {
  const priced = priceLines(pricingLinesFromStored(lines));
  const netById = new Map(priced.results.map((r) => [r.id, r.netPaisa]));
  const subtotal = priced.subtotalPaisa;
  if (subtotal <= 0) return { ok: false, error: "Nothing on this order was charged for, so there is nothing to refund item by item." };

  let share = 0;
  const described: string[] = [];
  for (const [i, it] of items.entries()) {
    if (items.findIndex((o) => o.lineId === it.lineId) !== i) return { ok: false, error: "The same item is listed twice." };
    const line = lines.find((l) => l.id === it.lineId);
    if (!line || line.isVoided) return { ok: false, error: "That item isn't on this order." };
    if (line.isComplimentary) return { ok: false, error: `${line.nameSnapshot} was complimentary, so nothing was paid for it.` };
    const left = line.quantity - line.refundedQuantity;
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > left) {
      return {
        ok: false,
        error: left === 0 ? `${line.nameSnapshot} has already been refunded.` : `Refund between 1 and ${left} of ${line.nameSnapshot}.`,
      };
    }
    share += ((netById.get(line.id) ?? 0) * it.quantity) / line.quantity;
    described.push(`${it.quantity}× ${line.nameSnapshot}`);
  }
  if (described.length === 0) return { ok: false, error: "Pick at least one item to refund." };

  const remaining = order.paidPaisa - order.refundedPaisa;
  const everythingNowRefunded = lines
    .filter((l) => !l.isVoided && !l.isComplimentary)
    .every((l) => l.quantity - l.refundedQuantity === (items.find((i) => i.lineId === l.id)?.quantity ?? 0));
  const amountPaisa = everythingNowRefunded ? remaining : Math.min(remaining, Math.round((order.paidPaisa * share) / subtotal));
  return { ok: true, amountPaisa, described: described.join(", ") };
}
