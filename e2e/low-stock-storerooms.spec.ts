import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Low stock with a main store and a kitchen.
 *
 * A restaurant buys into its main store and moves each day's stock to the kitchen, where sales
 * take it out. An ingredient has one low-stock level, and it used to be held against each
 * storeroom on its own: chicken with a 5 kg level, 20 kg in the store and the day's 3 kg in the
 * kitchen, showed the kitchen as low on the report and raised a dashboard alert every morning.
 *
 * The level answers "do we need to buy?", so it is judged on the branch's total. Moving stock
 * between storerooms changes nothing about that, and one ingredient raises one alert, not one per
 * storeroom.
 */

test.use({ storageState: authFile("owner") });

interface Row {
  locationId: string;
  itemId: string;
  quantity: number;
  branchQuantity: number;
  belowThreshold: boolean;
}

async function ok(res: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** The branch's first two storerooms, making a second if it has only one. Reused across runs by
 * name, so the suite doesn't add a storeroom every time it runs. */
async function twoStorerooms(request: APIRequestContext): Promise<[string, string]> {
  const { locations } = (await (await request.get("/api/inventory/locations")).json()) as {
    locations: { id: string; name: string; isActive: boolean }[];
  };
  const active = locations.filter((l) => l.isActive !== false);
  if (active.length >= 2) return [active[0].id, active[1].id];
  const made = await ok(await request.post("/api/inventory/locations", { data: { name: "E2E Kitchen" } }));
  return [active[0].id, made.location.id];
}

async function rowsFor(request: APIRequestContext, itemId: string): Promise<Row[]> {
  const { rows } = (await (await request.get("/api/inventory/report")).json()) as { rows: Row[] };
  return rows.filter((r) => r.itemId === itemId);
}

async function alertsFor(request: APIRequestContext, itemId: string) {
  const { alerts } = (await (await request.get("/api/inventory/low-stock-alerts")).json()) as {
    alerts: { itemId: string; quantityAtTrigger: number }[];
  };
  return alerts.filter((a) => a.itemId === itemId);
}

test("an ingredient is low when the branch runs short, not when one storeroom holds a day's worth", async ({ request, page }) => {
  const [store, kitchen] = await twoStorerooms(request);
  const name = `E2E Chicken ${uniqueSuffix()}`;
  const { item } = await ok(await request.post("/api/inventory/items", { data: { name, unitOfMeasure: "kg", lowStockThresholdQty: 5 } }));

  try {
    // Bought into the store, the day's share moved to the kitchen.
    await ok(await request.post("/api/inventory/grn", { data: { locationId: store, itemId: item.id, quantity: 20, costPaisa: 1_000_000 } }));
    await ok(await request.post("/api/inventory/transfer", { data: { fromLocationId: store, toLocationId: kitchen, itemId: item.id, quantity: 3 } }));

    let rows = await rowsFor(request, item.id);
    expect(rows.find((r) => r.locationId === kitchen)?.quantity).toBe(3);
    expect(rows.find((r) => r.locationId === store)?.quantity).toBe(17);
    expect(rows.every((r) => r.branchQuantity === 20), "each row carries the branch total").toBe(true);
    expect(rows.some((r) => r.belowThreshold), "3 kg in the kitchen is not low with 17 kg behind it").toBe(false);
    expect(await alertsFor(request, item.id), "and raises no alert").toHaveLength(0);

    // The store runs down: 4 kg left in the branch, under the 5 kg level.
    await ok(await request.post("/api/inventory/adjustment", { data: { locationId: store, itemId: item.id, quantityDelta: -16, reason: "E2E used up" } }));
    rows = await rowsFor(request, item.id);
    expect(rows.every((r) => r.belowThreshold), "now it is low, wherever it is kept").toBe(true);
    let alerts = await alertsFor(request, item.id);
    expect(alerts, "one alert for the ingredient, not one per storeroom").toHaveLength(1);
    expect(alerts[0].quantityAtTrigger).toBe(4);

    // Moving it back and forth changes nothing about whether to buy.
    await ok(await request.post("/api/inventory/transfer", { data: { fromLocationId: kitchen, toLocationId: store, itemId: item.id, quantity: 2 } }));
    alerts = await alertsFor(request, item.id);
    expect(alerts).toHaveLength(1);

    // The report says so in words, on the row.
    await page.goto("/app/inventory");
    const row = page.getByRole("row").filter({ hasText: name }).first();
    await expect(row.getByText("4 kg across all storerooms")).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("Low stock")).toBeVisible();

    // A delivery into either storeroom clears it.
    await ok(await request.post("/api/inventory/grn", { data: { locationId: kitchen, itemId: item.id, quantity: 10, costPaisa: 500_000 } }));
    expect(await alertsFor(request, item.id)).toHaveLength(0);
    rows = await rowsFor(request, item.id);
    expect(rows.some((r) => r.belowThreshold)).toBe(false);
  } finally {
    await request.delete(`/api/inventory/items/${item.id}`);
  }
});
