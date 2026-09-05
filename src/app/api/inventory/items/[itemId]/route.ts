import { defineHandler } from "@/server/handler";
import { archiveItem } from "@/server/inventory";

// DELETE /api/inventory/items/[itemId] — archives (soft-deletes) the item. See archiveItem's doc
// comment in src/server/inventory.ts for why this never hard-deletes.
export const DELETE = defineHandler(
  { permission: "inventory.item.manage", audit: () => ({ action: "inventory.item.archive", entityType: "InventoryItem" }) },
  async ({ session, params }) => {
    await archiveItem(session.tenantId, params.itemId);
    return { ok: true };
  }
);
