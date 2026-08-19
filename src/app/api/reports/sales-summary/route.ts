import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds, salesReport } from "@/server/reports";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/sales-summary?from=...&to=...[&branchId=...] — by day, by branch, by category,
// by payment method, with a comparison to the immediately-preceding equivalent period. Owners (or
// anyone with orders.viewAllBranches) see every branch unless one is requested; everyone else is
// restricted to their own branch regardless of what's requested.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  return salesReport(session.tenantId, branchIds, { from: new Date(input.from), to: new Date(input.to) });
});
