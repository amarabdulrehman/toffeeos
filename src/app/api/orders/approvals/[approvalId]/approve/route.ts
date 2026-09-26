import { defineHandler } from "@/server/handler";
import { approveOrderRequest } from "@/server/order-approvals";

// POST /api/orders/approvals/[approvalId]/approve — the counter sends a waiter's order to the
// kitchen, or adds their round to the order.
export const POST = defineHandler(
  {
    permission: "pos.payment.take",
    audit: (_input, result) => {
      const r = (result as { result: { orderId: string; kind: string } }).result;
      return { action: "order.approval.approve", entityType: "Order", entityId: r.orderId, metadata: { kind: r.kind } };
    },
  },
  async ({ session, params }) => {
    const result = await approveOrderRequest(session.tenantId, session.branchId, params.approvalId, session.id);
    return { result };
  }
);
