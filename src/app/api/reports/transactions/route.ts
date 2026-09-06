import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds, resolveReportRange, transactionsReport } from "@/server/reports";
import { isBusinessDay } from "@/lib/business-day";

const querySchema = z.object({
  from: z.string().refine(isBusinessDay, "Invalid date"),
  to: z.string().refine(isBusinessDay, "Invalid date"),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD[&branchId=...] — every individual
// paid sale in the range rather than a rollup, newest first. Sits behind reports.sales.view like
// the summary it itemises: someone allowed to see the day's total is by definition allowed to see
// what made it up.
export const GET = defineHandler(
  { permission: "reports.sales.view", input: querySchema },
  async ({ session, input }) => {
    const branchIds = await resolveReportBranchIds(session, input.branchId);
    const range = await resolveReportRange(session.tenantId, branchIds, input.from, input.to);
    return transactionsReport(session.tenantId, branchIds, range);
  }
);
