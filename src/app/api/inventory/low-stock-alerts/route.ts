import { defineHandler } from "@/server/handler";
import { listActiveLowStockAlerts } from "@/server/inventory";

// GET /api/inventory/low-stock-alerts — the dashboard badge's data source. Each row is written
// synchronously by inventory.ts whenever a movement crosses an item's threshold (see applyDelta) —
// a real background worker can drain these ACTIVE rows to WhatsApp/email in Phase 4 without any
// schema change; this endpoint is the "in-app" half of that same queue.
export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  const alerts = await listActiveLowStockAlerts(session.tenantId, session.branchId);
  return { alerts };
});
