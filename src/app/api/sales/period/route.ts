import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds } from "@/server/reports";
import { periodReport } from "@/server/daily-sales";

const querySchema = z.object({
  from: z.string(),
  to: z.string(),
  branchId: z.string().min(1).optional(),
});

// GET /api/sales/period — a week or month closing: totals, and every day in it.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  return periodReport(session.tenantId, branchIds, input.from, input.to);
});
