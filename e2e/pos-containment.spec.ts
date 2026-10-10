import { test, expect, type Page } from "@playwright/test";
import { authFile, SEED_MENU_CATEGORY, SEED_MENU_ITEM, SEED_MENU_ITEM_2 } from "./fixtures/test-data";

/**
 * When part of the till fails, the café keeps trading.
 *
 * On 9 October 2026 a café's POS showed "POS hit a problem" on and off during service: one error
 * anywhere replaced the whole till, and "Try again" brought it back with the order being rung up
 * gone. Each part now has its own boundary (src/components/errors/panel-boundary.tsx), the order
 * being rung up is kept through a reload, and every crash is reported to the server, because the
 * browser has no Sentry client of its own.
 *
 * The failures here are made the way a real one arrives: the server (or a cache) hands the till an
 * order it can't draw. Nothing in the app is switched into a test mode.
 */
// Service workers off: this is about boundaries, not offline (e2e/pos-resilience.spec.ts covers the
// worker), and in a production build requests passing through the worker are neither routed nor
// reported to Playwright — the crash report reached the server but the test could not see it.
test.use({ storageState: authFile("owner"), serviceWorkers: "block" });

async function openTill(page: Page) {
  await page.goto("/pos");
  await expect(page.getByText(/Online — all orders synced|unsynced/)).toBeVisible({ timeout: 30_000 });
}

async function ringUp(page: Page) {
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM.name }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name }).first().click();
  await expect(page.getByLabel(`Remove ${SEED_MENU_ITEM.name}`)).toBeVisible();
}

/** An order as GET /api/orders returns one, with its lines missing — what the queue can't draw. */
function brokenOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "broken-order",
    orderNumber: 999_001,
    type: "TAKEAWAY",
    status: "SENT_TO_KITCHEN",
    totalPaisa: 50_000,
    paidPaisa: 0,
    tableId: null,
    createdAt: new Date().toISOString(),
    lines: null,
    ...overrides,
  };
}

test("a queued order with no lines is still drawn", async ({ page }) => {
  await openTill(page);
  // What a bare order row looks like to the queue: no lines at all. It used to throw while drawing.
  await page.route("**/api/orders?day=today", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, orders: [brokenOrder(), ...(body.orders ?? [])] } });
  });
  await page.getByRole("button", { name: /Order Queue/ }).click();
  await expect(page.locator("div.rounded-xl", { hasText: "#999001" })).toContainText("0 items");
  await expect(page.getByText(/hit a problem/)).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("an order the queue can't draw is contained to the queue; the order being rung up survives", async ({ page }) => {
  await openTill(page);
  await ringUp(page);

  // The queue is handed an order it can't draw: no type at all.
  await page.route("**/api/orders?day=today", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, orders: [brokenOrder({ type: null, lines: [] }), ...(body.orders ?? [])] } });
  });
  // On the context, not the page: in a production build the service worker controls the page, and
  // requests that pass through it aren't reported as the page's own.
  const reported = page.context().waitForEvent("request", (r) => r.url().endsWith("/api/client-errors") && r.method() === "POST");

  await page.getByRole("button", { name: /Order Queue/ }).click();

  // The queue says it failed, and offers a way out.
  await expect(page.getByText("The Order Queue hit a problem")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to the order" })).toBeVisible();
  // The till itself did not fall over.
  await expect(page.getByText("POS hit a problem")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search menu" })).toBeVisible();

  // The server heard about it, with what broke.
  const report = (await reported).postDataJSON();
  expect(report.section).toBe("POS · The Order Queue");
  expect(report.message).toBeTruthy();

  // Back to the order: nothing that was rung up is lost.
  await page.getByRole("button", { name: "Back to the order" }).click();
  await expect(page.getByLabel(`Remove ${SEED_MENU_ITEM.name}`)).toBeVisible();
  await expect(page.getByLabel(`Remove ${SEED_MENU_ITEM_2.name}`)).toBeVisible();

  // And once the bad order is gone, the queue opens again by itself when it reloads.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByRole("button", { name: /Order Queue/ }).click();
  await expect(page.getByRole("heading", { name: "Order Queue" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/hit a problem/)).toHaveCount(0);
});

test("a payment window that can't price an order closes and says so, and the till carries on", async ({ page }) => {
  await openTill(page);

  // An order whose stored line price isn't a whole number of paisa: the dialog's own pricing
  // refuses it, as the engine is built to.
  await page.route("**/api/orders?day=today", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const line = { id: "l1", nameSnapshot: "Broken", quantity: 1, lineTotalPaisa: 100, unitPricePaisa: 100.5, isVoided: false, kitchenReady: false };
    await route.fulfill({ response: res, json: { ...body, orders: [brokenOrder({ lines: [line] }), ...(body.orders ?? [])] } });
  });

  await page.getByRole("button", { name: /Order Queue/ }).click();
  const row = page.locator("div.rounded-xl", { hasText: "#999001" });
  await row.getByRole("button", { name: "Payment" }).click();

  await expect(page.getByText("The payment window hit a problem and was closed")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Take payment" })).toHaveCount(0);
  await expect(page.getByText("POS hit a problem")).toHaveCount(0);
  // The queue is still there to work from.
  await expect(page.getByRole("heading", { name: "Order Queue" })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the order being rung up comes back after a reload", async ({ page }) => {
  await openTill(page);
  await ringUp(page);

  await page.reload();
  await expect(page.getByText("The order you were ringing up is back")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(`Remove ${SEED_MENU_ITEM.name}`)).toBeVisible();
  await expect(page.getByLabel(`Remove ${SEED_MENU_ITEM_2.name}`)).toBeVisible();

  // Cleared once it is dealt with: an emptied cart doesn't come back.
  await page.getByLabel(`Remove ${SEED_MENU_ITEM.name}`).click();
  await page.getByLabel(`Remove ${SEED_MENU_ITEM_2.name}`).click();
  await page.reload();
  await expect(page.getByText(/Online — all orders synced|unsynced/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The order you were ringing up is back")).toHaveCount(0);
});
