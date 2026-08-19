import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds, riderPerformanceReport } from "@/server/reports";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  branchId: z.string().min(1).optional(),
});

export const GET = defineHandler(
  { permission: "reports.riderPerformance.view", input: querySchema },
  async ({ session, input }) => {
    const branchIds = await resolveReportBranchIds(session, input.branchId);
    const rows = await riderPerformanceReport(session.tenantId, branchIds, { from: new Date(input.from), to: new Date(input.to) });
    return { rows };
  }
);
