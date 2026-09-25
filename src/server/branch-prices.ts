import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";

/**
 * A menu item's price at each branch.
 *
 * The till and the online menu have always charged BranchMenuItem.priceOverridePaisa when one is
 * set (see resolveLines in src/server/orders.ts and GET /api/menu) — there was just no way to set
 * one. A branch in a pricier part of town, or one whose rent is higher, can now charge its own
 * price for the same dish. Null means "the menu price". Sizes and add-ons keep their own price
 * differences on top, so a Large is still Rs 100 more than a Small wherever it is sold.
 */

export async function branchPrices(tenantId: string, menuItemId: string) {
  const db = tenantDb(tenantId);
  const item = await db.menuItem.findFirst({ where: { id: menuItemId }, select: { id: true, name: true, basePricePaisa: true } });
  if (!item) throw new HttpError(404, "That menu item doesn't exist.");
  const [branches, overrides] = await Promise.all([
    db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.branchMenuItem.findMany({ where: { menuItemId }, select: { branchId: true, priceOverridePaisa: true } }),
  ]);
  const override = new Map(overrides.map((o) => [o.branchId, o.priceOverridePaisa]));
  return {
    item,
    branches: branches.map((b) => ({ branchId: b.id, branchName: b.name, pricePaisa: override.get(b.id) ?? null })),
  };
}

export async function setBranchPrice(tenantId: string, menuItemId: string, branchId: string, pricePaisa: number | null) {
  if (pricePaisa !== null && (!Number.isInteger(pricePaisa) || pricePaisa < 0)) {
    throw new HttpError(400, "A price has to be zero or more.");
  }
  const db = tenantDb(tenantId);
  const item = await db.menuItem.findFirst({ where: { id: menuItemId }, select: { id: true } });
  if (!item) throw new HttpError(404, "That menu item doesn't exist.");
  return db.branchMenuItem.upsert({
    where: { branchId_menuItemId: { branchId, menuItemId } },
    create: { tenantId, branchId, menuItemId, priceOverridePaisa: pricePaisa },
    update: { priceOverridePaisa: pricePaisa },
  });
}
