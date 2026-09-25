import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getBranchPricingContext, pricingLinesFromStored } from "@/server/orders";
import { finalizeOrder, type DiscountInput } from "@/lib/pricing";

const tenderSchema = z.object({
  method: z.enum(["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"]),
  amountPaisa: z.number().int().min(0),
});
const previewSchema = z.object({ tenders: z.array(tenderSchema) });

// POST /api/orders/[orderId]/pay-preview — read-only dry run of the same finalizeOrder() pass
// takePayment uses to charge the order, so the payment dialog can show the real amount due for
// whatever tender split the cashier currently has selected (a cash-only total is Punjab PRA's 16%,
// a card-only total is 8% — they're genuinely different numbers, not a rounding nuance) instead of
// the provisional cash-rate estimate the order was created with. No write, no idempotency
// bookkeeping, no underpayment guard — this is purely "what would the total be right now."
export const POST = defineHandler(
  { permission: "pos.payment.take", input: previewSchema },
  async ({ session, db, params, input }) => {
    const order = await db.order.findUniqueOrThrow({
      where: { id: params.orderId },
      include: { lines: true, discounts: true },
    });

    const { settings, taxRules } = await getBranchPricingContext(
      session.tenantId,
      session.branchId,
      order.type,
      order.taxExemptReason !== null
    );
    const pricingLines = pricingLinesFromStored(order.lines);
    const orderDiscount: DiscountInput | undefined = order.discounts[0]
      ? { type: order.discounts[0].type, value: order.discounts[0].value }
      : undefined;

    // finalizeOrder() apportions the taxable base pro-rata across tenders — with zero tenders
    // (e.g. no CASH/CARD chosen yet) that degenerates to a single zero-weight slice, so fall back
    // to a full-amount CASH tender purely to get a representative preview total on first render.
    const tenders = input.tenders.length > 0 ? input.tenders : [{ method: "CASH" as const, amountPaisa: 0 }];
    const totals = finalizeOrder(pricingLines, orderDiscount, taxRules, settings, tenders);
    return { totals };
  }
);
