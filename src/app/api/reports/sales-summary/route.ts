import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds, resolveReportRange, salesReport } from "@/server/reports";
import { isBusinessDay } from "@/lib/business-day";

const querySchema = z.object({
  from: z.string().refine(isBusinessDay, "Invalid date"),
  to: z.string().refine(isBusinessDay, "Invalid date"),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/sales-summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&branchId=...] — by day, by branch,
// by category, by payment method, with a comparison to the immediately-preceding equivalent period.
// Owners (or anyone with orders.viewAllBranches) see every branch unless one is requested; everyone
// else is restricted to their own branch regardless of what's requested.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const range = await resolveReportRange(session.tenantId, branchIds, input.from, input.to);
  return salesReport(session.tenantId, branchIds, range);
});
