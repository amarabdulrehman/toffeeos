import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { itemWiseReport, resolveReportBranchIds } from "@/server/reports";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/item-wise?from=...&to=...[&branchId=...] — quantity sold and revenue per menu
// item across paid orders in the range, highest revenue first.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const items = await itemWiseReport(session.tenantId, branchIds, { from: new Date(input.from), to: new Date(input.to) });
  return { items };
});
