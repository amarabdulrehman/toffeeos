import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { discountVoidReport, resolveReportBranchIds, resolveReportRange } from "@/server/reports";
import { isBusinessDay } from "@/lib/business-day";

const querySchema = z.object({
  from: z.string().refine(isBusinessDay, "Invalid date"),
  to: z.string().refine(isBusinessDay, "Invalid date"),
  branchId: z.string().min(1).optional(),
});

export const GET = defineHandler({ permission: "reports.discountVoid.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const range = await resolveReportRange(session.tenantId, branchIds, input.from, input.to);
  const rows = await discountVoidReport(session.tenantId, branchIds, range);
  return { rows };
});
