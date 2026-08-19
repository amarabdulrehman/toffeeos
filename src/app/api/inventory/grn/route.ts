import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordGrn } from "@/server/inventory";

const schema = z.object({
  locationId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().positive(),
  costPaisa: z.number().int().nonnegative().optional(),
  supplierName: z.string().max(160).optional(),
});

export const POST = defineHandler(
  {
    permission: "inventory.grn.create",
    input: schema,
    audit: (input) => ({
      action: "inventory.grn.create",
      entityType: "InventoryItem",
      entityId: input.itemId,
      metadata: { ...input },
    }),
  },
  async ({ session, input }) => {
    const level = await recordGrn(session.tenantId, session.branchId, session.id, input);
    return level;
  }
);
