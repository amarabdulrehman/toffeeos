import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { stockReport } from "@/server/inventory";

const schema = z.object({ belowThresholdOnly: z.coerce.boolean().optional() });

export const GET = defineHandler({ permission: "inventory.view", input: schema }, async ({ session, input }) => {
  const rows = await stockReport(session.tenantId, session.branchId, { belowThresholdOnly: input.belowThresholdOnly });
  return { rows };
});
