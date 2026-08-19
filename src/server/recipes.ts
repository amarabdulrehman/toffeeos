import "server-only";
import { tenantDb, type TenantTransactionClient } from "@/server/db";
import { applyStockDelta } from "@/server/inventory";

export async function setRecipeLine(
  tenantId: string,
  menuItemId: string,
  inventoryItemId: string,
  quantityPerUnit: number
) {
  if (quantityPerUnit <= 0) throw new Error("Quantity per unit must be positive.");
  const db = tenantDb(tenantId);
  return db.recipeLine.upsert({
    where: { menuItemId_inventoryItemId: { menuItemId, inventoryItemId }, tenantId },
    create: { tenantId, menuItemId, inventoryItemId, quantityPerUnit },
    update: { quantityPerUnit },
  });
}

export async function removeRecipeLine(tenantId: string, recipeLineId: string) {
  const db = tenantDb(tenantId);
  return db.recipeLine.delete({ where: { id: recipeLineId } });
}

export async function getRecipe(tenantId: string, menuItemId: string) {
  const db = tenantDb(tenantId);
  return db.recipeLine.findMany({
    where: { menuItemId },
    include: { inventoryItem: true },
    orderBy: { createdAt: "asc" },
  });
}

/** For the menu management screen's "no recipe" badge. */
export async function listMenuItemsRecipeStatus(tenantId: string) {
  const db = tenantDb(tenantId);
  const items = await db.menuItem.findMany({
    where: { isActive: true },
    include: { category: true, recipeLines: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    categoryName: i.category.name,
    basePricePaisa: i.basePricePaisa,
    hasRecipe: i.recipeLines.length > 0,
  }));
}

/** "Current cost" is the most recent GRN's unit cost for that ingredient — deliberately last-in,
 * not a weighted average, so a new Stock In immediately becomes the new cost basis (per the Phase
 * 3 brief: "recalculate when ingredient costs change ... don't hardcode a stale cost"). Returns
 * null if the ingredient has never been received with a cost attached. */
export async function currentUnitCostPaisa(tenantId: string, inventoryItemId: string): Promise<number | null> {
  const db = tenantDb(tenantId);
  const lastGrn = await db.stockMovement.findFirst({
    where: { itemId: inventoryItemId, type: "GRN", costPaisa: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!lastGrn || !lastGrn.costPaisa || lastGrn.quantityDelta === 0) return null;
  return lastGrn.costPaisa / lastGrn.quantityDelta;
}

export interface ItemCosting {
  menuItemId: string;
  name: string;
  basePricePaisa: number;
  costPaisa: number | null; // null if any ingredient's cost is unknown or the item has no recipe
  marginPaisa: number | null;
  marginPct: number | null;
  hasRecipe: boolean;
  missingCostIngredients: string[]; // ingredient names with no GRN cost yet
}

/** Cost/margin for every active menu item, sorted by margin ascending (worst-margin first — the
 * ones the owner most needs to see) — the Recipe Cost report is just this, unsorted differently
 * by the UI as needed. */
export async function recipeCostReport(tenantId: string): Promise<ItemCosting[]> {
  const db = tenantDb(tenantId);
  const items = await db.menuItem.findMany({
    where: { isActive: true },
    include: { recipeLines: { include: { inventoryItem: true } } },
  });

  // Batch-fetch the latest GRN per ingredient actually used in a recipe, instead of N+1 queries.
  const ingredientIds = [...new Set(items.flatMap((i) => i.recipeLines.map((l) => l.inventoryItemId)))];
  const costByIngredient = new Map<string, number>();
  await Promise.all(
    ingredientIds.map(async (id) => {
      const cost = await currentUnitCostPaisa(tenantId, id);
      if (cost !== null) costByIngredient.set(id, cost);
    })
  );

  const results: ItemCosting[] = items.map((item) => {
    if (item.recipeLines.length === 0) {
      return {
        menuItemId: item.id,
        name: item.name,
        basePricePaisa: item.basePricePaisa,
        costPaisa: null,
        marginPaisa: null,
        marginPct: null,
        hasRecipe: false,
        missingCostIngredients: [],
      };
    }

    const missing: string[] = [];
    let costPaisa = 0;
    for (const line of item.recipeLines) {
      const unitCost = costByIngredient.get(line.inventoryItemId);
      if (unitCost === undefined) {
        missing.push(line.inventoryItem.name);
        continue;
      }
      costPaisa += unitCost * line.quantityPerUnit;
    }

    if (missing.length > 0) {
      return {
        menuItemId: item.id,
        name: item.name,
        basePricePaisa: item.basePricePaisa,
        costPaisa: null,
        marginPaisa: null,
        marginPct: null,
        hasRecipe: true,
        missingCostIngredients: missing,
      };
    }

    const roundedCost = Math.round(costPaisa);
    const marginPaisa = item.basePricePaisa - roundedCost;
    const marginPct = item.basePricePaisa > 0 ? (marginPaisa / item.basePricePaisa) * 100 : 0;
    return {
      menuItemId: item.id,
      name: item.name,
      basePricePaisa: item.basePricePaisa,
      costPaisa: roundedCost,
      marginPaisa,
      marginPct,
      hasRecipe: true,
      missingCostIngredients: [],
    };
  });

  return results.sort((a, b) => (a.marginPct ?? Infinity) - (b.marginPct ?? Infinity));
}

/** Which StockLocation recipe consumption deducts from: BranchSettings.defaultStockLocationId if
 * set and still valid, else the branch's oldest active location, else null (meaning "skip
 * deduction" — a tenant with inventory not set up yet shouldn't have payments fail). */
async function resolveConsumptionLocation(tx: TenantTransactionClient, tenantId: string, branchId: string) {
  const settings = await tx.branchSettings.findUnique({ where: { branchId, tenantId } });
  if (settings?.defaultStockLocationId) {
    const loc = await tx.stockLocation.findFirst({
      where: { id: settings.defaultStockLocationId, tenantId, isActive: true },
    });
    if (loc) return loc.id;
  }
  const fallback = await tx.stockLocation.findFirst({
    where: { branchId, tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return fallback?.id ?? null;
}

/**
 * Deducts recipe ingredient quantities for every paid line item. Called from
 * src/server/orders.ts's takePayment — payment is the "completed" event (not order creation),
 * so voided/cancelled orders never reach this. Items with no recipe are silently skipped (not an
 * error) — the "no recipe" badge on the menu screen is how the owner finds out, not a blocked sale.
 * Runs inside the caller's transaction so a deduction failure rolls back the payment too.
 */
export async function deductForOrder(
  tx: TenantTransactionClient,
  tenantId: string,
  branchId: string,
  orderLines: { menuItemId: string; quantity: number }[],
  actorId: string
): Promise<void> {
  const locationId = await resolveConsumptionLocation(tx, tenantId, branchId);
  if (!locationId) return; // no stock location configured yet for this branch — nothing to deduct against

  const menuItemIds = [...new Set(orderLines.map((l) => l.menuItemId))];
  const recipeLines = await tx.recipeLine.findMany({ where: { menuItemId: { in: menuItemIds }, tenantId } });
  const linesByMenuItem = new Map<string, typeof recipeLines>();
  for (const line of recipeLines) {
    const arr = linesByMenuItem.get(line.menuItemId) ?? [];
    arr.push(line);
    linesByMenuItem.set(line.menuItemId, arr);
  }

  for (const orderLine of orderLines) {
    const recipe = linesByMenuItem.get(orderLine.menuItemId);
    if (!recipe || recipe.length === 0) continue; // no recipe defined — skip, don't block the sale

    for (const ingredient of recipe) {
      const delta = -(ingredient.quantityPerUnit * orderLine.quantity);
      await tx.stockMovement.create({
        data: {
          tenantId,
          branchId,
          itemId: ingredient.inventoryItemId,
          locationId,
          type: "RECIPE_CONSUMPTION",
          quantityDelta: delta,
          actorId,
        },
      });
      await applyStockDelta(tx, tenantId, branchId, locationId, ingredient.inventoryItemId, delta);
    }
  }
}
