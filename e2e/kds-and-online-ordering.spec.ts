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
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { order } = await createRes.json();
    const sent = await ownerCtx.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
    // Assert the setup, or a failure here surfaces as "the card never appeared" — a timeout that
    // blames the board for an order that was never sent to it.
    expect(sent.ok(), await sent.text()).toBeTruthy();
    await ownerCtx.dispose();

    await page.goto("/kds");
    // 15s was too tight to be a real budget. The board does fetch on mount, but this budget has to
    // cover the dev server compiling /kds on its first visit in a run, hydration, and a query over
    // a demo board carrying months of orders — and if any of that overruns, the next chance is the
    // 15s poll (kds-board.tsx), which the old timeout could not wait for. Two poll periods plus
    // slack, so the test fails on the behaviour rather than on the clock.
    await expect(page.getByText(`#${order.orderNumber}`)).toBeVisible({ timeout: 35_000 });

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

  test("the board shows what was added to a line and what was written on it", async ({ page, baseURL }) => {
    /**
     * /api/kds/orders has always included `lines: { include: { modifiers: true } }`, and the board
     * rendered the line name and nothing else. So a latte ordered with an extra shot reached the
     * barista as "1x Latte" and they made a plain one — charged for, not delivered, and no error
     * anywhere. The line's note ("no sugar") was equally invisible.
     *
     * Asserted on screen rather than on the endpoint, because the endpoint was already right. The
     * whole defect lived in the rendering.
     */
    const ownerCtx = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    const suffix = Math.random().toString(36).slice(2, 8);

    // Its own item: attaching a modifier group to a seeded one turns every other spec's single tap
    // into a dialog.
    const categoryId = (await (await ownerCtx.post("/api/menu", { data: { name: `E2E KDS Extras ${suffix}` } })).json()).id;
    const itemName = `KDS Addon Probe ${suffix}`;
    const itemBody = await (
      await ownerCtx.post("/api/menu-items", { data: { categoryId, name: itemName, basePricePaisa: 50_000 } })
    ).json();
    const menuItemId = itemBody.item?.id ?? itemBody.id;
    const groupId = (
      await (await ownerCtx.post("/api/modifier-groups", { data: { name: `KDS Extras ${suffix}`, minSelect: 0, maxSelect: 1 } })).json()
    ).group.id;
    const modifierId = (
      await (await ownerCtx.post(`/api/modifier-groups/${groupId}/modifiers`, {
        data: { name: "Extra Shot", priceDeltaPaisa: 10_000 },
      })).json()
    ).modifier.id;
    await ownerCtx.put(`/api/menu-items/${menuItemId}/modifier-groups`, { data: { groupIds: [groupId] } });

    const createRes = await ownerCtx.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `kds-addon-e2e-${suffix}`,
        lines: [{ menuItemId, quantity: 1, modifierIds: [modifierId], notes: "No sugar" }],
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { order } = await createRes.json();
    const sent = await ownerCtx.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
    expect(sent.ok(), await sent.text()).toBeTruthy();
    await ownerCtx.dispose();

    await page.goto("/kds");
    await expect(page.getByText(`#${order.orderNumber}`)).toBeVisible({ timeout: 35_000 });
    const card = page.locator("div.rounded-2xl", { has: page.getByText(`#${order.orderNumber}`, { exact: true }) });

    await expect(card.getByText(itemName)).toBeVisible();
    await expect(card.getByText("+ Extra Shot"), "the add-on changes what the kitchen makes").toBeVisible();
    await expect(card.getByText("— No sugar"), "and so does the note").toBeVisible();
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
