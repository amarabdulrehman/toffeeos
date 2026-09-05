import { defineHandler } from "@/server/handler";
import { reviewOrderCancellation } from "@/server/orders";
import { resolveReportBranchIds } from "@/server/reports";

// POST /api/order-cancellations/[id]/review — a manager/owner acknowledging they've seen a
// kitchen-stage cancellation. Same permission as viewing the list; there's no separate
// "write" permission for this, matching how the payroll disbursement "mark as paid" audit
// action reuses its view permission.
export const POST = defineHandler({ permission: "reports.cancellation.view" }, async ({ session, params }) => {
  const branchIds = await resolveReportBranchIds(session, undefined);
  const cancellation = await reviewOrderCancellation(session.tenantId, branchIds, params.id, session.id);
  return { cancellation };
});
