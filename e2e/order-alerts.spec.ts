import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { authFile, uniqueSuffix, TENANT_SLUG } from "./fixtures/test-data";
import { getAvailableTable, getMenuItemId } from "./fixtures/api";

/**
 * The till hears about orders placed somewhere else.
 *
 * A waiter punching an order on their own phone reached the kitchen and nobody at the counter: no
 * pop-up, no sound, nothing until the cashier happened to open the Order Queue. And a waiter never
 * heard that their order was ready. Now:
 *
 * - someone who takes payment gets a pop-up (and the chime) for each order placed from another
 *   device, and a count on the Order Queue button of orders still to be paid;
 * - whoever placed an order gets a pop-up when the kitchen marks it ready; an online or QR order's
 *   "ready" goes to the counter, since a customer placed it.
 *
 * The till checks on a 15-second timer as well as on the live channel, so these waits allow for the
 * timer alone.
 */

const ALERT_WAIT = 30_000;

async function till(browser: Browser, baseURL: string | undefined, who: "cashier" | "waiter"): Promise<Page> {
  const context = await browser.newContext({ baseURL, storageState: authFile(who) });
  const page = await context.newPage();
  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
  // The till's first look sets its starting point; wait for it, so what follows is "new".
  await page.waitForResponse((r) => r.url().includes("/api/orders/activity"), { timeout: 20_000 }).catch(() => {});
  return page;
}

async function placeOrder(ctx: APIRequestContext, opts: { sendToKitchen?: boolean } = {}) {
  const menuItemId = await getMenuItemId(ctx, "Fish Pakora");
  const res = await ctx.post("/api/orders", {
    data: { type: "TAKEAWAY", idempotencyKey: `alert-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 2 }] },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const order = (await res.json()).order as { id: string; orderNumber: number };
  if (opts.sendToKitchen) expect((await ctx.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} })).ok()).toBeTruthy();
  return order;
}

const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __toffeeChimes?: number }).__toffeeChimes ?? 0);

test.describe("Order alerts at the till", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a waiter's order pops up on the cashier's till, with the chime and a count", async ({ browser, baseURL }) => {
    const cashierTill = await till(browser, baseURL, "cashier");
    const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
    try {
      const order = await placeOrder(waiter, { sendToKitchen: true });

      await expect(cashierTill.getByText(`New order #${order.orderNumber}`), "the cashier is told").toBeVisible({ timeout: ALERT_WAIT });
      const waiterName = (await (await waiter.get("/api/auth/session")).json()).user.name as string;
      await expect(cashierTill.getByText(`by ${waiterName}`).first(), "and who placed it").toBeVisible();
      expect(await chimes(cashierTill), "with the chime").toBeGreaterThan(0);
      await expect(cashierTill.getByTestId("queue-count"), "and the count of orders to be paid").toBeVisible();

      // "Open" takes them to it.
      await cashierTill.getByRole("button", { name: "Open" }).first().click();
      await expect(cashierTill.getByRole("heading", { name: "Order Queue" }).first()).toBeVisible();
      await expect(cashierTill.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await waiter.dispose();
      await cashierTill.context().close();
    }
  });

  test("an order the cashier punched themselves doesn't pop up on their own till", async ({ browser, baseURL }) => {
    const cashierTill = await till(browser, baseURL, "cashier");
    const cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    try {
      const order = await placeOrder(cashier);
      // Long enough for the timer to have looked at least once.
      await cashierTill.waitForTimeout(20_000);
      await expect(cashierTill.getByText(`New order #${order.orderNumber}`)).toHaveCount(0);
      expect(await chimes(cashierTill)).toBe(0);
    } finally {
      await cashier.dispose();
      await cashierTill.context().close();
    }
  });

  test("the waiter who placed an order hears when it's ready", async ({ browser, baseURL }) => {
    const waiterTill = await till(browser, baseURL, "waiter");
    const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
    const kitchen = await playwrightRequest.newContext({ baseURL, storageState: authFile("kitchen") });
    try {
      const order = await placeOrder(waiter, { sendToKitchen: true });
      // Their own new order doesn't pop up on their own phone...
      expect((await kitchen.post(`/api/orders/${order.id}/ready`)).ok()).toBeTruthy();
      // ...its being ready does.
      await expect(waiterTill.getByText(`Order #${order.orderNumber} is ready`)).toBeVisible({ timeout: ALERT_WAIT });
      await expect(waiterTill.getByText(`New order #${order.orderNumber}`)).toHaveCount(0);
      expect(await chimes(waiterTill)).toBeGreaterThan(0);
    } finally {
      await waiter.dispose();
      await kitchen.dispose();
      await waiterTill.context().close();
    }
  });

  test("a QR order pops up at the counter, and so does its being ready", async ({ browser, baseURL, playwright }) => {
    const cashierTill = await till(browser, baseURL, "cashier");
    const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    const anon = await playwright.request.newContext({ baseURL });
    const kitchen = await playwrightRequest.newContext({ baseURL, storageState: authFile("kitchen") });
    try {
      const table = await getAvailableTable(owner);
      const menuItemId = await getMenuItemId(owner, "Dahi Bhalla");
      const res = await anon.post(`/api/online-order/${TENANT_SLUG}/qr-checkout`, {
        data: { tableId: table.id, customerName: "Alert Probe", idempotencyKey: `qr-alert-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const order = (await res.json()).order as { id: string; orderNumber: number };

      await expect(cashierTill.getByText(`New order #${order.orderNumber}`)).toBeVisible({ timeout: ALERT_WAIT });
      await expect(cashierTill.getByText(/QR code at the table/).first()).toBeVisible();

      expect((await kitchen.post(`/api/orders/${order.id}/ready`)).ok()).toBeTruthy();
      await expect(cashierTill.getByText(`Order #${order.orderNumber} is ready`), "a customer's order: the counter hands it over").toBeVisible({
        timeout: ALERT_WAIT,
      });
    } finally {
      await owner.dispose();
      await anon.dispose();
      await kitchen.dispose();
      await cashierTill.context().close();
    }
  });

  test("the sound can be turned off, and stays off on that device", async ({ browser, baseURL }) => {
    const cashierTill = await till(browser, baseURL, "cashier");
    const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
    try {
      await cashierTill.getByRole("button", { name: "Turn alert sound off" }).click();
      await cashierTill.reload();
      await expect(cashierTill.getByRole("button", { name: "Turn alert sound on" }), "remembered").toBeVisible({ timeout: 20_000 });
      await cashierTill.waitForResponse((r) => r.url().includes("/api/orders/activity"), { timeout: 20_000 }).catch(() => {});

      const order = await placeOrder(waiter);
      await expect(cashierTill.getByText(`New order #${order.orderNumber}`), "still told").toBeVisible({ timeout: ALERT_WAIT });
      expect(await chimes(cashierTill), "but without the sound").toBe(0);
    } finally {
      await waiter.dispose();
      await cashierTill.context().close();
    }
  });

  test("the activity check is for signed-in staff only", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get("/api/orders/activity")).status()).toBe(401);
    await anon.dispose();
  });
});
