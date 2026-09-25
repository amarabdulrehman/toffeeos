import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordTransfer } from "@/server/inventory";
import { requestTransfer } from "@/server/purchasing";

const schema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().positive(),
  note: z.string().max(200).nullish(),
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
    // Someone who may approve transfers moves the stock straight away, as before. Anyone else asks,
    // and nothing moves until an approver says yes (inventory.transfer.approve).
    if (!session.permissions.includes("inventory.transfer.approve")) {
      const request = await requestTransfer(session.tenantId, session.id, input);
      return { requested: true, requestId: request.id };
    }
    const result = await recordTransfer(session.tenantId, session.id, input);
    return { requested: false, ...result };
  }
);
