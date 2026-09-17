import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { removeVariant, updateVariant } from "@/server/menu-options";

const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  pricePaisa: z.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input) => ({ action: "menu_item.variant.update", entityType: "ItemVariant", metadata: { ...input } }),
  },
  async ({ session, params, input }) => {
    const variant = await updateVariant(session.tenantId, params.variantId, input);
    return { variant };
  }
);

export const DELETE = defineHandler(
  {
    permission: "menu.manage",
    audit: () => ({ action: "menu_item.variant.delete", entityType: "ItemVariant" }),
  },
  async ({ session, params }) => {
    await removeVariant(session.tenantId, params.variantId);
    return { ok: true };
  }
);
