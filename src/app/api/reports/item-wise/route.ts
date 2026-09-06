import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { itemWiseReport, resolveReportBranchIds, resolveReportRange } from "@/server/reports";
import { isBusinessDay } from "@/lib/business-day";

const querySchema = z.object({
  from: z.string().refine(isBusinessDay, "Invalid date"),
  to: z.string().refine(isBusinessDay, "Invalid date"),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/item-wise?from=YYYY-MM-DD&to=YYYY-MM-DD[&branchId=...] — quantity sold and
// revenue per menu item across paid orders in the range, highest revenue first.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const range = await resolveReportRange(session.tenantId, branchIds, input.from, input.to);
  const items = await itemWiseReport(session.tenantId, branchIds, range);
  return { items };
});
