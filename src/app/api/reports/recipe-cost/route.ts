import { defineHandler } from "@/server/handler";
import { recipeCostReport } from "@/server/recipes";

export const GET = defineHandler({ permission: "costing.viewMargins" }, async ({ session }) => {
  const items = await recipeCostReport(session.tenantId);
  return { items };
});
