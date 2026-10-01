import { defineHandler, HttpError } from "@/server/handler";
import { runInTenantTransaction } from "@/server/db";

/**
 * Takes a category, and every item in it, off the menu.
 *
 * Categories could be created but never removed. The items go with it rather than blocking the
 * delete until each has been removed by hand: someone deleting a whole section of the menu wants
 * the section gone, and the confirm dialog says how many items that is before anything happens.
 *
 * Archived, not erased, for the same reason as a single item (see menu-items/[menuItemId]): past
 * orders point at these items and the sales reports group by this category through them. Every
 * order line keeps the name it was sold under, so receipts are unaffected.
 */
export const DELETE = defineHandler(
  {
    permission: "menu.manage",
    audit: (_input, result) => {
      const r = result as { id: string; name: string; itemsRemoved: number };
      return {
        action: "menu_category.delete",
        entityType: "Category",
        entityId: r.id,
        metadata: { name: r.name, itemsRemoved: r.itemsRemoved },
      };
    },
  },
  async ({ session, db, params }) => {
    const category = await db.category.findFirst({ where: { id: params.categoryId, isActive: true } });
    if (!category) throw new HttpError(404, "That category doesn't exist.");

    // Together or not at all: a category gone with its items still live would leave dishes on the
    // till under a heading that no longer exists anywhere else.
    // tenantId is set by hand on both writes: inside an interactive transaction nothing injects it.
    const itemsRemoved = await runInTenantTransaction(session.tenantId, async (tx) => {
      const items = await tx.menuItem.updateMany({
        where: { tenantId: session.tenantId, categoryId: category.id, isActive: true },
        data: { isActive: false },
      });
      await tx.category.updateMany({
        where: { tenantId: session.tenantId, id: category.id },
        data: { isActive: false },
      });
      return items.count;
    });

    return { id: category.id, name: category.name, itemsRemoved };
  }
);
