import { defineHandler } from "@/server/handler";
import { listTransferRequests } from "@/server/purchasing";

// GET /api/inventory/transfer-requests — transfers waiting for approval, and past decisions.
export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  return { requests: await listTransferRequests(session.tenantId) };
});
