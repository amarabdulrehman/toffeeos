import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getRecipe, setRecipeLine } from "@/server/recipes";

export const GET = defineHandler({ permission: "recipe.view" }, async ({ session, params }) => {
  const lines = await getRecipe(session.tenantId, params.menuItemId);
  return { lines };
});

const schema = z.object({
  inventoryItemId: z.string().min(1),
  quantityPerUnit: z.number().positive(),
});

export const POST = defineHandler(
  { permission: "recipe.manage", input: schema },
  async ({ session, params, input }) => {
    const line = await setRecipeLine(session.tenantId, params.menuItemId, input.inventoryItemId, input.quantityPerUnit);
    return { line };
  }
);
