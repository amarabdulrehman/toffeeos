import { defineHandler } from "@/server/handler";
import { listRecentAdjustments } from "@/server/purchasing";

// GET /api/inventory/adjustments — recent stock adjustments at this branch, and which were undone.
export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  return { adjustments: await listRecentAdjustments(session.tenantId, session.branchId) };
});
