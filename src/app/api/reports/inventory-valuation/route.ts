import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { inventoryValuationReport, resolveReportBranchIds } from "@/server/reports";

const querySchema = z.object({ branchId: z.string().min(1).optional() });

export const GET = defineHandler(
  { permission: "reports.inventoryValuation.view", input: querySchema },
  async ({ session, input }) => {
    const branchIds = await resolveReportBranchIds(session, input.branchId);
    return inventoryValuationReport(session.tenantId, branchIds);
  }
);
