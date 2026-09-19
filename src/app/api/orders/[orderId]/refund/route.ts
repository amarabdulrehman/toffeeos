import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listRefunds, refundOrder } from "@/server/refunds";

// GET the refunds already recorded against an order — the POS shows these so a manager can see what
// has been returned before deciding how much more to give back.
export const GET = defineHandler({ permission: "pos.access" }, async ({ session, params }) => {
  const refunds = await listRefunds(session.tenantId, params.orderId);
  return { refunds };
});

const schema = z.object({
  amountPaisa: z.number().int().positive(),
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
      metadata: { amountPaisa: input.amountPaisa, method: input.method, reason: input.reason },
    }),
  },
  async ({ session, params, input }) => {
    const { refund, order } = await refundOrder(
      session.tenantId,
      session.branchId,
      params.orderId,
      session.id,
      input
    );
    return { refund, order };
  }
);
