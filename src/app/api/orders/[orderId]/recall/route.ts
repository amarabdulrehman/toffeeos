import { defineHandler } from "@/server/handler";
import { recallOrder } from "@/server/order-changes";

// POST /api/orders/[orderId]/recall — bring a bumped order back onto the kitchen screen.
export const POST = defineHandler(
  {
    permission: "kds.order.recall",
    audit: (_input, result) => ({
      action: "order.recall",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
    }),
  },
  async ({ session, params }) => {
    const order = await recallOrder(session.tenantId, session.branchId, session.id, params.orderId);
    return { order };
  }
);
