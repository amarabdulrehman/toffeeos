import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds } from "@/server/reports";
import { dayReport } from "@/server/daily-sales";

const querySchema = z.object({
  // Omitted means today, by the branch's own clock — including a day that ends after midnight.
  date: z.string().optional(),
  branchId: z.string().min(1).optional(),
});

// GET /api/sales/day — one business day in full: totals, payment methods, hours, items, staff.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  return dayReport(session.tenantId, branchIds, input.date);
});
