import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { mergeOrders } from "@/server/order-changes";

const schema = z.object({
  /** The other table's order, whose items move onto this one. */
  sourceOrderId: z.string().min(1),
});

// POST /api/orders/[orderId]/merge — two tables pushed together: the other order's items join this
// one, and its table is freed.
export const POST = defineHandler(
  {
    permission: "tables.merge",
    input: schema,
    audit: (input, result) => ({
      action: "order.merge",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
      metadata: { mergedOrderId: input.sourceOrderId },
    }),
  },
  async ({ session, params, input }) => {
    const order = await mergeOrders(session.tenantId, session.branchId, session.id, {
      targetOrderId: params.orderId,
      sourceOrderId: input.sourceOrderId,
    });
    return { order };
  }
);
