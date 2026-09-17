import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { addVariant, listVariants } from "@/server/menu-options";

// Sizes for one menu item. Prices here are absolute (what the customer pays for that size); the
// delta the schema stores is an implementation detail of src/server/menu-options.ts.
export const GET = defineHandler({ permission: "menu.view" }, async ({ session, params }) => {
  const variants = await listVariants(session.tenantId, params.menuItemId);
  return { variants };
});

const schema = z.object({
  name: z.string().min(1).max(80),
  pricePaisa: z.number().int().min(0),
});

export const POST = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input, result) => ({
      action: "menu_item.variant.create",
      entityType: "ItemVariant",
      entityId: (result as { variant: { id: string } }).variant.id,
      metadata: { name: input.name, pricePaisa: input.pricePaisa },
    }),
  },
  async ({ session, params, input }) => {
    const variant = await addVariant(session.tenantId, params.menuItemId, input);
    return { variant };
  }
);
