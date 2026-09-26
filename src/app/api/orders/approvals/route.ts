import { defineHandler } from "@/server/handler";
import { listPendingApprovals } from "@/server/order-approvals";

// GET /api/orders/approvals — waiter orders and rounds waiting for the counter in this branch.
// See src/server/order-approvals.ts.
export const GET = defineHandler({ permission: "pos.payment.take" }, async ({ session }) => {
  const approvals = await listPendingApprovals(session.tenantId, session.branchId);
  return { approvals };
});
