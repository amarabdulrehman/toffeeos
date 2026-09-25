import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { voidOrderLine } from "@/server/order-changes";

const schema = z.object({
  /** How many to take off. Omitted voids the whole line. */
  quantity: z.number().int().positive().optional(),
  // Required, unlike a whole-order void's: taking one dish off a bill is the most common way a till
  // loses money quietly, and "why" is the first thing an owner asks about it.
  reason: z.string().trim().min(2, "Say why it's being voided.").max(200),
});

// POST /api/orders/[orderId]/lines/[lineId]/void — take one item (or some of it) off an unpaid order.
export const POST = defineHandler(
  {
    permission: "pos.order.voidLine",
    input: schema,
    audit: (input, result) => ({
      action: "order.line.void",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
      metadata: { quantity: input.quantity ?? "all", reason: input.reason },
    }),
  },
  async ({ session, params, input }) => {
    const order = await voidOrderLine(session.tenantId, session.branchId, session.id, {
      orderId: params.orderId,
      lineId: params.lineId,
      quantity: input.quantity,
      reason: input.reason,
    });
    return { order };
  }
);
