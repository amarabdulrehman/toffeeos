import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";

// Editing and removing a single menu item. Until this route existed an item could be created, priced
// per branch and given sizes and add-ons, but never renamed, repriced, moved to another category, or
// taken off the menu — a typo in a dish name was there for good.

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    categoryId: z.string().min(1).optional(),
    basePricePaisa: z.number().int().min(0).max(100_000_000).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

type Snapshot = { name: string; categoryId: string; basePricePaisa: number; description: string | null };

export const PATCH = defineHandler(
  {
    permission: "menu.manage",
    input: updateSchema,
    // Before and after, because a price change is exactly what gets questioned later.
    audit: (input, result) => {
      const r = result as { item: { id: string }; before: Snapshot };
      return {
        action: "menu_item.update",
        entityType: "MenuItem",
        entityId: r.item.id,
        metadata: { before: r.before, changes: input },
      };
    },
  },
  async ({ session, db, params, input }) => {
    const existing = await db.menuItem.findFirst({ where: { id: params.menuItemId, isActive: true } });
    if (!existing) throw new HttpError(404, "That menu item doesn't exist.");

    if (input.categoryId && input.categoryId !== existing.categoryId) {
      const category = await db.category.findFirst({
        where: { id: input.categoryId, tenantId: session.tenantId, isActive: true },
      });
      if (!category) throw new HttpError(404, "That category doesn't exist.");
    }

    const item = await db.menuItem.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.basePricePaisa !== undefined ? { basePricePaisa: input.basePricePaisa } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      },
    });

    const before: Snapshot = {
      name: existing.name,
      categoryId: existing.categoryId,
      basePricePaisa: existing.basePricePaisa,
      description: existing.description,
    };
    return { item, before };
  }
);

/**
 * Takes an item off the menu.
 *
 * Archived, not erased. Every order that ever sold it points at it, and the reports group sales by
 * its category through that link; erasing the row would turn a year of history for the dish into
 * "Uncategorized". Each order line already carries the name it was sold under, so receipts and
 * bills are unaffected either way. Once archived it is gone from the till, the online and QR menus,
 * and this list.
 */
export const DELETE = defineHandler(
  {
    permission: "menu.manage",
    audit: (_input, result) => {
      const r = result as { id: string; name: string };
      return { action: "menu_item.delete", entityType: "MenuItem", entityId: r.id, metadata: { name: r.name } };
    },
  },
  async ({ db, params }) => {
    const existing = await db.menuItem.findFirst({ where: { id: params.menuItemId, isActive: true } });
    if (!existing) throw new HttpError(404, "That menu item doesn't exist.");
    await db.menuItem.update({ where: { id: existing.id }, data: { isActive: false } });
    return { id: existing.id, name: existing.name };
  }
);
