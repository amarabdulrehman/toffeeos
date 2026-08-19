import { defineHandler } from "@/server/handler";
import { removeRecipeLine } from "@/server/recipes";

export const DELETE = defineHandler({ permission: "recipe.manage" }, async ({ session, params }) => {
  await removeRecipeLine(session.tenantId, params.recipeLineId);
  return { ok: true };
});
