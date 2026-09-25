import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";

const schema = z.object({ isAvailableOnline: z.boolean() });

// PATCH /api/menu-items/[menuItemId]/online — show or hide one dish on the online and QR menus.
// The till is unaffected. online.menu.manage: deciding what customers can order without a person in
// the loop is its own call, separate from editing the menu itself.
export const PATCH = defineHandler(
  {
    permission: "online.menu.manage",
    input: schema,
    audit: (input) => ({ action: "menu.online.set", entityType: "MenuItem", metadata: { ...input } }),
  },
  async ({ db, params, input }) => {
    const item = await db.menuItem.findFirst({ where: { id: params.menuItemId }, select: { id: true } });
    if (!item) throw new HttpError(404, "That menu item doesn't exist.");
    const updated = await db.menuItem.update({
      where: { id: item.id },
      data: { isAvailableOnline: input.isAvailableOnline },
      select: { id: true, isAvailableOnline: true },
    });
    return { item: updated };
  }
);
