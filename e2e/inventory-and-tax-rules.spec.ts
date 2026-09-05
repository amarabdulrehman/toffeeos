import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

test.use({ storageState: authFile("owner") });

test.describe("Inventory item delete (archive, not hard-delete)", () => {
  test("a deleted item disappears from active pickers but the row survives with isActive=false", async ({ request }) => {
    const name = `E2E Test Item ${uniqueSuffix()}`;

    const createRes = await request.post("/api/inventory/items", {
      data: { name, unitOfMeasure: "kg", lowStockThresholdQty: 5 },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { item } = await createRes.json();

    const listBefore = await request.get("/api/inventory/items");
    const itemsBefore = (await listBefore.json()).items;
    expect(itemsBefore.some((i: { id: string }) => i.id === item.id)).toBe(true);

    const deleteRes = await request.delete(`/api/inventory/items/${item.id}`);
    expect(deleteRes.ok(), await deleteRes.text()).toBeTruthy();

    const listAfter = await request.get("/api/inventory/items");
    const itemsAfter = (await listAfter.json()).items;
    expect(itemsAfter.some((i: { id: string }) => i.id === item.id)).toBe(false);

    // Deleting an already-archived item again is a deliberate no-op (still 200) rather than a
    // 404 — archiveItem just re-asserts isActive:false, which is harmless and matches DELETE's
    // idempotent semantics under HTTP. Asserting that explicitly here so a future change that
    // makes this throw on a missing/inactive row is a conscious choice, not a surprise.
    const secondDelete = await request.delete(`/api/inventory/items/${item.id}`);
    expect(secondDelete.status()).toBe(200);

    // A genuinely unknown id, on the other hand, must 404 — this is what actually guards against
    // a delete route that doesn't check existence at all.
    const bogusDelete = await request.delete(`/api/inventory/items/not-a-real-id`);
    expect(bogusDelete.status()).toBe(404);
  });
});

test.describe("Tax rule overlap validation", () => {
  test("creating a second active rule covering an already-covered payment method is rejected", async ({ request }) => {
    const existingRes = await request.get("/api/tax-rules");
    const { rules } = await existingRes.json();
    const activeCash = rules.find((r: { paymentMethods: string[]; isActive: boolean }) => r.isActive && r.paymentMethods.includes("CASH"));
    expect(activeCash, "the demo branch should already have an active CASH-covering rule").toBeTruthy();

    const conflictRes = await request.post("/api/tax-rules", {
      data: { name: `E2E overlap probe ${uniqueSuffix()}`, rateBasisPoints: 999, paymentMethods: ["CASH"] },
    });
    expect(conflictRes.status()).toBe(400);
    const body = await conflictRes.json();
    expect(body.error).toContain("already active");
  });

  test("a rule covering a genuinely free payment method is accepted, then cleaned up", async ({ request }) => {
    // OTHER is deliberately never assigned by the seed (only CASH/CARD/JAZZCASH/EASYPAISA/
    // BANK_TRANSFER are), so this should never collide regardless of what else is active.
    const createRes = await request.post("/api/tax-rules", {
      data: { name: `E2E free-method rule ${uniqueSuffix()}`, rateBasisPoints: 100, paymentMethods: ["OTHER"] },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { rule } = await createRes.json();

    const cleanup = await request.delete(`/api/tax-rules/${rule.id}`);
    expect(cleanup.ok()).toBeTruthy();
  });
});
