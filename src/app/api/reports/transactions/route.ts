import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds, transactionsReport } from "@/server/reports";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/transactions?from=...&to=...[&branchId=...] — every individual paid sale in the
// range rather than a rollup, newest first. Sits behind reports.sales.view like the summary it
// itemises: someone allowed to see the day's total is by definition allowed to see what made it up.
export const GET = defineHandler(
  { permission: "reports.sales.view", input: querySchema },
  async ({ session, input }) => {
    const branchIds = await resolveReportBranchIds(session, input.branchId);
    return transactionsReport(session.tenantId, branchIds, {
      from: new Date(input.from),
      to: new Date(input.to),
    });
  }
);
