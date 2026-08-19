import { z } from "zod";
import { defineHandler } from "@/server/handler";

// GET /api/menu — the POS product grid's main data source: every active category, with its
// active items, each item's variants/modifier groups, and this branch's availability/price
// override. isAvailable === false items are still returned (so the POS can show them struck out)
// rather than silently hidden.
export const GET = defineHandler({ permission: "pos.access" }, async ({ session, db }) => {
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: {
          variants: { orderBy: { sortOrder: "asc" } },
          modifierGroups: { include: { group: { include: { modifiers: true } } } },
          branchMenuItems: { where: { branchId: session.branchId } },
        },
      },
    },
  });

  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((item) => {
        const override = item.branchMenuItems[0];
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          basePricePaisa: override?.priceOverridePaisa ?? item.basePricePaisa,
          isAvailable: override?.isAvailable ?? true,
          allergens: item.allergens,
          variants: item.variants.map((v) => ({
            id: v.id,
            name: v.name,
            priceDeltaPaisa: v.priceDeltaPaisa,
            isDefault: v.isDefault,
          })),
          modifierGroups: item.modifierGroups.map((mig) => ({
            id: mig.group.id,
            name: mig.group.name,
            minSelect: mig.group.minSelect,
            maxSelect: mig.group.maxSelect,
            modifiers: mig.group.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
              priceDeltaPaisa: m.priceDeltaPaisa,
            })),
          })),
        };
      }),
    })),
  };
});

const createCategorySchema = z.object({ name: z.string().min(1).max(80) });

export const POST = defineHandler(
  { permission: "menu.manage", input: createCategorySchema },
  async ({ session, db, input }) => {
    const last = await db.category.aggregate({ _max: { sortOrder: true } });
    return db.category.create({
      data: { tenantId: session.tenantId, name: input.name, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
  }
);
