import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { rejectOrderRequest } from "@/server/order-approvals";

const schema = z.object({ reason: z.string().trim().min(2, "Say why, so the waiter can tell the table.").max(200) });

// POST /api/orders/approvals/[approvalId]/reject — the counter turns a waiter's order or round
// away, with the reason the waiter is shown.
export const POST = defineHandler(
  {
    permission: "pos.payment.take",
    input: schema,
    audit: (input, result) => {
      const r = (result as { result: { orderId: string; kind: string } }).result;
      return { action: "order.approval.reject", entityType: "Order", entityId: r.orderId, metadata: { kind: r.kind, reason: input.reason } };
    },
  },
  async ({ session, params, input }) => {
    const result = await rejectOrderRequest(session.tenantId, session.branchId, params.approvalId, session.id, input.reason);
    return { result };
  }
);
