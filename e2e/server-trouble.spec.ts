import { test, expect } from "@playwright/test";
import { authFile, SEED_MENU_CATEGORY, SEED_MENU_ITEM } from "./fixtures/test-data";

/**
 * The till keeps taking orders when the server is in trouble.
 *
 * Built after the database host's account went over its monthly quota (November 2026) and started
 * refusing some services. A struggling back end answers with errors (5xx) rather than not at all,
 * and the till used to treat those differently from a dropped connection:
 * - an order the server couldn't save showed "Could not create order" and was gone;
 * - a menu request that errored was read as an empty menu and saved over the good copy on the
 *   device, so the till had nothing to sell even after a refresh.
 * Now a 5xx is treated like no connection: the order is kept on the device and sent when the
 * server is back, and an error never replaces what the device already has.
 *
 * The errors are faked in the browser (page.route), so nothing here depends on the server actually
 * failing. The service worker is blocked so the browser's own requests can be intercepted.
 */

test.use({ storageState: authFile("owner"), serviceWorkers: "block" });
test.describe.configure({ timeout: 120_000 });

test("an error answer for the menu doesn't wipe the menu the till already has", async ({ page }) => {
  await page.goto("/pos");
  await expect(page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first()).toBeVisible({ timeout: 30_000 });

  await page.route("**/api/menu", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"down"}' }));
  await page.reload();
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first(),
    "the menu saved on the device is still there to sell from"
  ).toBeVisible({ timeout: 30_000 });
});

test("an order the server can't save is kept on the device and sent once it can", async ({ page, request }) => {
  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 30_000 });

  // Takeaway, so no table is needed.
  await page.getByRole("combobox", { name: "Order type" }).click();
  await page.getByRole("option", { name: "Takeaway" }).click();
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first().click();

  // The server is in trouble for creating orders, and only for that.
  let refused = 0;
  await page.route("**/api/orders", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    refused += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"down"}' });
  });
  await page.getByRole("button", { name: "Send to Kitchen" }).click();
  await expect(page.getByText(/queued offline/i).first(), "kept, not lost").toBeVisible({ timeout: 20_000 });
  expect(refused).toBeGreaterThan(0);

  // Read the queued order's id from the device, then let the server recover.
  const queuedId = await page.evaluate(async () => {
    const open = indexedDB.open("tableos-offline");
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const all: { type: string; orderId: string }[] = await new Promise((res) => {
      const req = db.transaction("queue").objectStore("queue").getAll();
      req.onsuccess = () => res(req.result);
    });
    return all.find((a) => a.type === "createOrder")?.orderId ?? null;
  });
  expect(queuedId, "the order is in the device's queue").toBeTruthy();
  await page.unroute("**/api/orders");

  // Sent when the server answers again: it reaches the kitchen, once.
  await expect
    .poll(
      async () => {
        const { orders } = (await (await request.get("/api/orders")).json()) as { orders: { id: string; status: string }[] };
        return orders.filter((o) => o.id === queuedId).map((o) => o.status);
      },
      { timeout: 60_000, intervals: [2_000] }
    )
    .toEqual(["SENT_TO_KITCHEN"]);

  await request.post(`/api/orders/${queuedId}/void`, { data: { reason: "E2E cleanup" } });
});
