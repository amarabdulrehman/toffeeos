import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordAdjustment } from "@/server/inventory";

// This is the one place shrinkage/theft could hide, so `reason` is required at every layer
// (zod here, the type signature in inventory.ts, and a runtime check inside recordAdjustment) —
// and every call is audit-logged with the full before/after context.
const schema = z.object({
  locationId: z.string().min(1),
  itemId: z.string().min(1),
  quantityDelta: z.number().refine((v) => v !== 0, "Adjustment cannot be zero"),
  reason: z.string().min(3).max(280),
});

export const POST = defineHandler(
  {
    permission: "inventory.adjustment.create",
    input: schema,
    audit: (input) => ({
      action: "inventory.adjustment.create",
      entityType: "InventoryItem",
      entityId: input.itemId,
      metadata: { ...input },
    }),
  },
  async ({ session, input }) => {
    const level = await recordAdjustment(session.tenantId, session.branchId, session.id, input);
    return level;
  }
);
