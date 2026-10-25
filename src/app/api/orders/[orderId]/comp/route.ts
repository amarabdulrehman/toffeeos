import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { compOrderItems } from "@/server/order-changes";

const schema = z.object({
  /** Which items, and how many of each. Omitted gives the whole bill. */
  items: z.array(z.object({ lineId: z.string().min(1), quantity: z.number().int().positive().optional() })).min(1).optional(),
  // Required: food given away with no reason is the first thing an owner asks about, and the
  // obvious cover for a till that's short.
  reason: z.string().trim().min(2, "Say why it's complimentary.").max(200),
});

// POST /api/orders/[orderId]/comp — give items, or the whole bill, free. See compOrderItems.
export const POST = defineHandler(
  {
    permission: "pos.order.comp",
    input: schema,
    audit: (input, result) => ({
      action: "order.comp",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
      metadata: { wholeBill: !input.items, items: input.items ?? null, reason: input.reason },
    }),
  },
  async ({ session, params, input }) =>
    compOrderItems(session.tenantId, session.branchId, session.id, {
      orderId: params.orderId,
      items: input.items,
      reason: input.reason,
    })
);
