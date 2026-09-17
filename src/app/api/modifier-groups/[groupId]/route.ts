import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { removeModifierGroup, updateModifierGroup } from "@/server/menu-options";

const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  minSelect: z.number().int().min(0).max(50).optional(),
  maxSelect: z.number().int().min(1).max(50).optional(),
});

export const PATCH = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input) => ({ action: "modifier_group.update", entityType: "ModifierGroup", metadata: { ...input } }),
  },
  async ({ session, params, input }) => {
    const group = await updateModifierGroup(session.tenantId, params.groupId, input);
    return { group };
  }
);

export const DELETE = defineHandler(
  {
    permission: "menu.manage",
    audit: () => ({ action: "modifier_group.delete", entityType: "ModifierGroup" }),
  },
  async ({ session, params }) => {
    await removeModifierGroup(session.tenantId, params.groupId);
    return { ok: true };
  }
);
