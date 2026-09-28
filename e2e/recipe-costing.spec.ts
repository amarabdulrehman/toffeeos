import { test, expect } from "@playwright/test";
import { authFile } from "./fixtures/test-data";

/**
 * Dish costing and margin.
 *
 * This had no coverage of any kind, and it is money arithmetic an owner makes pricing decisions on
 * — "which dish is actually carrying the menu" is the headline claim of the Recipe & Costing
 * module. A margin that is quietly wrong is worse than one that is missing: the owner acts on it.
 *
 * The arithmetic under test: unit cost comes from the most recent GRN (cost ÷ quantity received),
 * a dish's cost is the sum of each ingredient's unit cost × the quantity the recipe uses, and
 * margin is the menu price minus that. The intermediate is deliberately fractional — a 1,500 paisa
 * delivery of 3kg is 500 paisa/kg, but 1,000 paisa of 3kg is 333.33 — and it is rounded once, at
 * the end. Rounding per ingredient instead would accumulate error across a long recipe, so this
 * asserts the single-rounding behaviour rather than just "a number came back".
 */

const uniq = () => Math.random().toString(36).slice(2, 8);

test.describe("Recipe costing", () => {
  test.use({ storageState: authFile("owner") });

  test("cost is the sum of ingredient costs, rounded once, and margin follows from it", async ({ request }) => {
    // Create the stock location rather than assume the seed left one: the demo tenant has
    // inventory items but no location, and a test that depends on seed state it did not create is
    // a test that fails for a reason that has nothing to do with what it is checking.
    const locations = await request.get("/api/inventory/locations");
    expect(locations.ok(), await locations.text()).toBeTruthy();
    let locationId: string | undefined = (await locations.json()).locations[0]?.id;

    if (!locationId) {
      const created = await request.post("/api/inventory/locations", {
        data: { name: `costing-store-${uniq()}` },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      locationId = (await created.json()).location.id;
    }
    expect(locationId).toBeTruthy();

    // Two ingredients with deliberately awkward unit costs: 1000/3 = 333.333… and 1000/7 =
    // 142.857…, neither of which is a whole paisa.
    const made: { id: string; perUnit: number; unitCost: number }[] = [];
    for (const [qty, cost, perUnit] of [
      [3, 1000, 2],
      [7, 1000, 1],
    ] as const) {
      const item = await request.post("/api/inventory/items", {
        data: { name: `costing-${uniq()}`, unitOfMeasure: "kg", lowStockThresholdQty: 0 },
      });
      expect(item.ok(), await item.text()).toBeTruthy();
      const id = (await item.json()).item.id;

      const grn = await request.post("/api/inventory/grn", {
        data: { locationId, itemId: id, quantity: qty, costPaisa: cost },
      });
      expect(grn.ok(), await grn.text()).toBeTruthy();

      made.push({ id, perUnit, unitCost: cost / qty });
    }

    // Attach both to a menu item nothing else in the suite depends on.
    const menu = await request.get("/api/menu");
    expect(menu.ok()).toBeTruthy();
    const categories = (await menu.json()).categories ?? [];
    const menuItem = categories.flatMap((c: { items: { id: string; name: string; basePricePaisa: number }[] }) => c.items)[0];
    expect(menuItem, "the demo tenant needs at least one menu item").toBeTruthy();

    // A run that died before its own clean-up (a timeout mid-delete) leaves its lines on this dish,
    // and they'd be counted in the cost below: seen once, 952 instead of 810. So clear any line
    // these tests made, by the names they give their ingredients, before adding this run's.
    const leftover = await request.get(`/api/menu-items/${menuItem.id}/recipe`);
    if (leftover.ok()) {
      for (const line of ((await leftover.json()).lines ?? []) as { id: string; inventoryItem?: { name?: string } }[]) {
        if (/^(costing|uncosted)-/.test(line.inventoryItem?.name ?? "")) {
          await request.delete(`/api/recipe-lines/${line.id}`);
        }
      }
    }

    for (const m of made) {
      const res = await request.post(`/api/menu-items/${menuItem.id}/recipe`, {
        data: { inventoryItemId: m.id, quantityPerUnit: m.perUnit },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    const report = await request.get("/api/reports/recipe-cost");
    expect(report.ok(), await report.text()).toBeTruthy();
    const row = ((await report.json()).items as { menuItemId: string; costPaisa: number; marginPaisa: number; marginPct: number; hasRecipe: boolean }[])
      .find((r) => r.menuItemId === menuItem.id);

    expect(row, "the item we just gave a recipe should appear in the costing report").toBeTruthy();
    expect(row!.hasRecipe).toBe(true);

    // 333.333… × 2  +  142.857… × 1  =  809.523…  ->  810
    const exact = made.reduce((sum, m) => sum + m.unitCost * m.perUnit, 0);
    expect(row!.costPaisa, "cost should be the exact sum rounded once, not per ingredient").toBe(Math.round(exact));

    // Rounding each ingredient first gives 333 × 2 + 143 = 809 — one paisa out. The point of
    // asserting this is that the difference grows with the length of the recipe.
    const roundedPerIngredient = made.reduce((sum, m) => sum + Math.round(m.unitCost) * m.perUnit, 0);
    expect(roundedPerIngredient).not.toBe(Math.round(exact));

    expect(row!.marginPaisa).toBe(menuItem.basePricePaisa - row!.costPaisa);
    expect(row!.marginPct).toBeCloseTo((row!.marginPaisa / menuItem.basePricePaisa) * 100, 6);

    // Clean up so the demo menu item is left as we found it.
    const recipe = await request.get(`/api/menu-items/${menuItem.id}/recipe`);
    if (recipe.ok()) {
      for (const line of (await recipe.json()).lines ?? []) {
        if (made.some((m) => m.id === line.inventoryItemId)) {
          await request.delete(`/api/recipe-lines/${line.id}`);
        }
      }
    }
  });

  test("an ingredient with no recorded cost makes the margin unknown, not wrong", async ({ request }) => {
    // The failure that matters: guessing a cost of zero would report a 100% margin on a dish
    // whose ingredient price nobody has entered, which is worse than reporting nothing.
    const item = await request.post("/api/inventory/items", {
      data: { name: `uncosted-${uniq()}`, unitOfMeasure: "kg", lowStockThresholdQty: 0 },
    });
    expect(item.ok(), await item.text()).toBeTruthy();
    const itemId = (await item.json()).item.id;

    const menu = await request.get("/api/menu");
    const categories = (await menu.json()).categories ?? [];
    const menuItem = categories.flatMap((c: { items: { id: string }[] }) => c.items).at(-1);
    expect(menuItem).toBeTruthy();

    const attach = await request.post(`/api/menu-items/${menuItem.id}/recipe`, {
      data: { inventoryItemId: itemId, quantityPerUnit: 1 },
    });
    expect(attach.ok(), await attach.text()).toBeTruthy();

    const report = await request.get("/api/reports/recipe-cost");
    const row = ((await report.json()).items as {
      menuItemId: string;
      costPaisa: number | null;
      marginPaisa: number | null;
      missingCostIngredients: string[];
    }[]).find((r) => r.menuItemId === menuItem.id);

    expect(row!.costPaisa, "no cost is knowable, so none should be claimed").toBeNull();
    expect(row!.marginPaisa).toBeNull();
    expect(row!.missingCostIngredients.length, "and the owner should be told which ingredient").toBeGreaterThan(0);

    const recipe = await request.get(`/api/menu-items/${menuItem.id}/recipe`);
    if (recipe.ok()) {
      for (const line of (await recipe.json()).lines ?? []) {
        if (line.inventoryItemId === itemId) await request.delete(`/api/recipe-lines/${line.id}`);
      }
    }
  });
});
