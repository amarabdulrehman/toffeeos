import { z } from "zod";
import { defineHandler } from "@/server/handler";

const bodySchema = z.object({ isAvailable: z.boolean() });

/** Toggles whether an item is sellable at the caller's own branch right now — "86'd." This was a
 * real gap: BranchMenuItem.isAvailable was read everywhere (POS, the online ordering site) but
 * nothing could ever set it. One flag, one source of truth, so marking an item unavailable here
 * makes it grey out on the POS grid and disappear from ordering on the public site immediately,
 * not on separate schedules. */
export const PATCH = defineHandler(
  { permission: "menu.branchAvailability", input: bodySchema },
  async ({ session, params, db, input }) => {
    const record = await db.branchMenuItem.upsert({
      where: { branchId_menuItemId: { branchId: session.branchId, menuItemId: params.menuItemId } },
      create: { tenantId: session.tenantId, branchId: session.branchId, menuItemId: params.menuItemId, isAvailable: input.isAvailable },
      update: { isAvailable: input.isAvailable },
    });
    return { branchMenuItem: record };
  }
);
