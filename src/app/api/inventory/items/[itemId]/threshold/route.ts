import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";

const schema = z.object({ lowStockThresholdQty: z.number().nonnegative().max(1_000_000) });

// PATCH /api/inventory/items/[itemId]/threshold — change when an item's low-stock alert fires. Items
// could only be given an alert level when created; this is how it gets changed afterwards.
export const PATCH = defineHandler(
  {
    permission: "inventory.lowStockAlert.configure",
    input: schema,
    audit: (input) => ({ action: "inventory.item.threshold", entityType: "InventoryItem", metadata: { ...input } }),
  },
  async ({ db, params, input }) => {
    const item = await db.inventoryItem.findFirst({ where: { id: params.itemId }, select: { id: true } });
    if (!item) throw new HttpError(404, "That item doesn't exist.");
    const updated = await db.inventoryItem.update({
      where: { id: item.id },
      data: { lowStockThresholdQty: input.lowStockThresholdQty },
      select: { id: true, lowStockThresholdQty: true },
    });
    return { item: updated };
  }
);
