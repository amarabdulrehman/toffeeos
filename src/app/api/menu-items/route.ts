import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { listMenuItemsRecipeStatus } from "@/server/recipes";

// GET /api/menu-items — menu items with their "has a recipe?" flag, for the menu management screen.
export const GET = defineHandler({ permission: "menu.view" }, async ({ session }) => {
  const items = await listMenuItemsRecipeStatus(session.tenantId, session.branchId);
  return { items };
});

const createMenuItemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(120),
  basePricePaisa: z.number().int().min(0),
  description: z.string().max(500).optional(),
});

// POST /api/menu-items — was previously missing entirely: a tenant could create a category
// (POST /api/menu) but had no way to add an actual item to it, anywhere in the product.
export const POST = defineHandler(
  {
    permission: "menu.manage",
    input: createMenuItemSchema,
    audit: (input, result) => ({
      action: "menu_item.create",
      entityType: "MenuItem",
      entityId: (result as { id: string }).id,
      metadata: { name: input.name, categoryId: input.categoryId },
    }),
  },
  async ({ session, db, input }) => {
    const category = await db.category.findFirst({ where: { id: input.categoryId, tenantId: session.tenantId } });
    if (!category) throw new HttpError(404, "Category not found.");
    return db.menuItem.create({
      data: {
        tenantId: session.tenantId,
        categoryId: input.categoryId,
        name: input.name,
        basePricePaisa: input.basePricePaisa,
        description: input.description || undefined,
      },
    });
  }
);
