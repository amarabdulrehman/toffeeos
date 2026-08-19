import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordTransfer } from "@/server/inventory";

const schema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().positive(),
});

export const POST = defineHandler(
  {
    permission: "inventory.transfer.create",
    input: schema,
    audit: (input) => ({
      action: "inventory.transfer.create",
      entityType: "InventoryItem",
      entityId: input.itemId,
      metadata: { ...input },
    }),
  },
  async ({ session, input }) => {
    const result = await recordTransfer(session.tenantId, session.id, input);
    return result;
  }
);
