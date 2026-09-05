import { test, expect, request as playwrightRequest } from "@playwright/test";
import { authFile, TENANT_SLUG } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

test.describe("KDS", () => {
  test.use({ storageState: authFile("kitchen") });

  test("kitchen staff sees a sent order and can mark it ready", async ({ page, request, baseURL }) => {
    // Create a real order as the owner would (a different, request-only context — this test's own
    // storageState is the kitchen role, which can't create orders).
    const ownerCtx = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    const itemId = await getMenuItemId(ownerCtx, "Fish Pakora");
    const createRes = await ownerCtx.post("/api/orders", {
      data: { type: "TAKEAWAY", idempotencyKey: `kds-e2e-${Date.now()}`, lines: [{ menuItemId: itemId, quantity: 1 }] },
    });
    const { order } = await createRes.json();
    await ownerCtx.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
    await ownerCtx.dispose();

    await page.goto("/kds");
    await expect(page.getByText(`#${order.orderNumber}`)).toBeVisible({ timeout: 15_000 });

    // This demo board carries months of other test orders (including ones also containing "Fish
    // Pakora") — scope to this specific order's own card (src/components/kds/kds-board.tsx's
    // OrderCard root: "rounded-2xl border-t-...") via an *exact* match on its order-number div,
    // not a substring/regex match, which could ambiguously hit "#139" inside "#1390" etc.
    const card = page.locator("div.rounded-2xl", { has: page.getByText(`#${order.orderNumber}`, { exact: true }) });
    await expect(card.getByText("Fish Pakora")).toBeVisible();
    await card.getByRole("button", { name: /Mark Ready/i }).click();

    await expect.poll(async () => {
      const res = await request.get("/api/kds/orders");
      const { orders } = await res.json();
      return orders.find((o: { id: string }) => o.id === order.id)?.status;
    }).toBe("READY");
  });
});

test.describe("Online ordering", () => {
  test.use({ storageState: authFile("owner") });

  test("QR ordering: two rounds at the same table merge into one order, not a duplicate", async ({ request, baseURL }) => {
    const anon = await playwrightRequest.newContext({ baseURL });

    const tablesRes = await request.get("/api/tables");
    const { floors } = await tablesRes.json();
    const table = floors.flatMap((f: { tables: { id: string; status: string; label: string }[] }) => f.tables).find(
      (t: { status: string }) => t.status === "AVAILABLE"
    );
    expect(table, "need at least one AVAILABLE table for QR ordering").toBeTruthy();

    const itemA = await getMenuItemId(anon, "Beef Chapli Kebab");
    const itemB = await getMenuItemId(anon, "Dahi Bhalla");

    const round1 = await anon.post(`/api/online-order/${TENANT_SLUG}/qr-checkout`, {
      data: {
        tableId: table.id,
        customerName: "E2E QR Customer",
        idempotencyKey: `qr-e2e-1-${Date.now()}`,
        lines: [{ menuItemId: itemA, quantity: 1 }],
      },
    });
    expect(round1.ok(), await round1.text()).toBeTruthy();
    const order1 = (await round1.json()).order;

    const round2 = await anon.post(`/api/online-order/${TENANT_SLUG}/qr-checkout`, {
      data: {
        tableId: table.id,
        customerName: "E2E QR Customer",
        idempotencyKey: `qr-e2e-2-${Date.now()}`,
        lines: [{ menuItemId: itemB, quantity: 1 }],
      },
    });
    expect(round2.ok(), await round2.text()).toBeTruthy();
    const order2 = (await round2.json()).order;

    // The whole point: round 2 attaches to round 1's order, it never creates a second one.
    expect(order2.id).toBe(order1.id);
    expect(order2.totalPaisa).toBeGreaterThan(order1.totalPaisa);

    await anon.dispose();
  });
});
