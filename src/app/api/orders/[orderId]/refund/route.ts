import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { listRefunds, refundOrder } from "@/server/refunds";

// GET the refunds already recorded against an order — the POS shows these so a manager can see what
// has been returned before deciding how much more to give back.
export const GET = defineHandler({ permission: "pos.access" }, async ({ session, params }) => {
  const refunds = await listRefunds(session.tenantId, params.orderId);
  return { refunds };
});

const schema = z.object({
  /** Required for a typed refund; with `items` the server works it out and ignores this. */
  amountPaisa: z.number().int().positive().optional(),
  items: z.array(z.object({ lineId: z.string().min(1), quantity: z.number().int().positive() })).min(1).optional(),
  method: z.enum(["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"]),
  // Required, not optional. A refund with no reason is the one every owner asks about a week later
  // and nobody can answer, and it is the obvious cover for a staff member pocketing the difference.
  reason: z.string().min(1).max(280),
});

// POST /api/orders/[orderId]/refund — give money back. pos.payment.refund has existed in the
// registry from the beginning with nothing to enforce it; this is that enforcement point.
export const POST = defineHandler(
  {
    permission: "pos.payment.refund",
    input: schema,
    audit: (input, result) => ({
      action: "order.refund",
      entityType: "Refund",
      entityId: (result as { refund: { id: string } }).refund.id,
      metadata: {
        amountPaisa: (result as { refund: { amountPaisa: number } }).refund.amountPaisa,
        items: input.items ?? null,
        method: input.method,
        reason: input.reason,
      },
    }),
  },
  async ({ session, params, input }) => {
    if (!input.items && input.amountPaisa == null) throw new HttpError(400, "Enter an amount to refund, or pick the items.");
    const { refund, order } = await refundOrder(
      session.tenantId,
      session.branchId,
      params.orderId,
      session.id,
      { ...input, amountPaisa: input.amountPaisa ?? 0 }
    );
    return { refund, order };
  }
);
