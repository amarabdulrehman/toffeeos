import { defineHandler } from "@/server/handler";

// GET /api/menu/categories — id+name for every category, including ones with zero items yet.
// Separate from GET /api/menu (which is POS-only, gated by pos.access, and only returns
// categories alongside their items) so the menu-management screen's category picker works for a
// brand-new tenant with no items — or no categories — at all.
export const GET = defineHandler({ permission: "menu.view" }, async ({ db }) => {
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  return { categories };
});
