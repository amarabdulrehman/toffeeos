import { defineHandler } from "@/server/handler";
import { listMenuItemsRecipeStatus } from "@/server/recipes";

// GET /api/menu-items — menu items with their "has a recipe?" flag, for the menu management screen.
export const GET = defineHandler({ permission: "menu.view" }, async ({ session }) => {
  const items = await listMenuItemsRecipeStatus(session.tenantId, session.branchId);
  return { items };
});
