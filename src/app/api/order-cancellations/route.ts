import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listOrderCancellations } from "@/server/orders";
import { resolveReportBranchIds } from "@/server/reports";

const querySchema = z.object({
  unreviewedOnly: z.enum(["true", "false"]).optional(),
  branchId: z.string().min(1).optional(),
});

// GET /api/order-cancellations — Reports > Cancellations tab (full history) and the dashboard
// banner (?unreviewedOnly=true). Same owner-sees-all/manager-sees-own branch scoping as every
// other report.
export const GET = defineHandler({ permission: "reports.cancellation.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const cancellations = await listOrderCancellations(session.tenantId, branchIds, input.unreviewedOnly === "true");
  return { cancellations };
});
