import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createModifierGroup, listModifierGroups } from "@/server/menu-options";

// Add-on groups are tenant-wide and reusable — one "House Dips" offered by every fries item,
// rather than a copy per item that has to be edited six times.
export const GET = defineHandler({ permission: "menu.view" }, async ({ session }) => {
  const groups = await listModifierGroups(session.tenantId);
  return { groups };
});

const schema = z.object({
  name: z.string().min(1).max(80),
  minSelect: z.number().int().min(0).max(50),
  maxSelect: z.number().int().min(1).max(50),
});

export const POST = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input, result) => ({
      action: "modifier_group.create",
      entityType: "ModifierGroup",
      entityId: (result as { group: { id: string } }).group.id,
      metadata: { name: input.name },
    }),
  },
  async ({ session, input }) => {
    const group = await createModifierGroup(session.tenantId, input);
    return { group };
  }
);
