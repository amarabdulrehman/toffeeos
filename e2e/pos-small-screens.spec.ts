import { test, expect, type Page } from "@playwright/test";
import { authFile, SEED_MENU_CATEGORY, SEED_MENU_ITEM } from "./fixtures/test-data";
import { getAvailableTable } from "./fixtures/api";

/**
 * Taking an order on the screens cafés actually hold.
 *
 * The till was one layout with a fixed 340px cart. On a landscape iPad that was fine; on a portrait
 * tablet the cart took 42% of the width and the search box slid under the Order Queue button; on a
 * phone the cart ran off the right edge and the menu became a strip too narrow to read. None of that
 * failed a test, because every test ran on a desktop-sized screen.
 *
 * Each size here takes a whole order through to payment, since "the page renders" was exactly the
 * bar the old layout cleared while being unusable.
 */

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the till must never scroll sideways").toBeLessThanOrEqual(0);
}

async function searchAndQueueDoNotOverlap(page: Page) {
  // The bug that was visible in the first screenshot: the search field ran underneath this button.
  const search = await page.getByRole("textbox", { name: "Search menu" }).boundingBox();
  const queue = await page.getByRole("button", { name: "Order Queue" }).boundingBox();
  expect(search && queue, "both should be on screen").toBeTruthy();
  expect(search!.x + search!.width, "search must end before the Order Queue button starts").toBeLessThanOrEqual(queue!.x);
}

async function addSeedItem(page: Page) {
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first().click();
}

async function payInCash(page: Page) {
  await page.getByRole("button", { name: "Take Payment" }).click();
  const pay = page.getByRole("dialog", { name: "Take payment" });
  await expect(pay).toBeVisible({ timeout: 30_000 });
  await page.waitForResponse((r) => r.url().includes("/pay-preview") && r.ok(), { timeout: 30_000 }).catch(() => {});
  const confirm = pay.getByRole("button", { name: "Confirm payment" });
  // In the viewport, not merely in the DOM: a dialog taller than a phone used to be able to leave
  // this below the bottom edge.
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await Promise.all([
    page.waitForResponse((r) => /\/api\/orders\/[^/]+\/pay$/.test(r.url()) && r.request().method() === "POST"),
    confirm.click(),
  ]);
  await expect(page.getByRole("dialog", { name: /Receipt/ })).toBeVisible({ timeout: 30_000 });
}

test.describe("POS on small screens", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 180_000 });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("takes an order through to payment, with the cart in a sheet", async ({ page, request }) => {
      const table = await getAvailableTable(request);
      await page.goto("/pos");
      await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
      await noSidewaysScroll(page);
      await searchAndQueueDoNotOverlap(page);

      // The cart is off-screen until asked for, and not reachable while it is.
      await expect(page.getByRole("button", { name: "Send to Kitchen" })).not.toBeInViewport();

      await addSeedItem(page);
      // The bar at the bottom carries the order while the menu keeps the screen.
      const bar = page.getByRole("button", { name: "View order" });
      await expect(bar).toBeInViewport();
      await expect(page.getByText("1 item", { exact: true })).toBeVisible();

      await bar.click();
      await expect(page.getByRole("button", { name: "Send to Kitchen" })).toBeInViewport();

      await page.getByRole("button", { name: "Select a table" }).click();
      await page.getByRole("dialog").getByText(table.label, { exact: true }).click();

      await payInCash(page);

      // A finished sale puts the cashier back on the menu for the next customer.
      await page.keyboard.press("Escape");
      await expect(page.getByText("Tap items to add them", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send to Kitchen" })).not.toBeInViewport();
      await noSidewaysScroll(page);
    });
  });

  test.describe("tablet, portrait", () => {
    test.use({ viewport: { width: 810, height: 1080 }, hasTouch: true });

    test("keeps menu and cart side by side, and takes an order through to payment", async ({ page, request }) => {
      const table = await getAvailableTable(request);
      await page.goto("/pos");
      await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
      await noSidewaysScroll(page);
      await searchAndQueueDoNotOverlap(page);

      // Wide enough for both: no bar, the cart simply there.
      await expect(page.getByRole("button", { name: "View order" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Send to Kitchen" })).toBeInViewport();

      // The cart gives the menu most of the screen now, rather than 42% of it.
      const cartWidth = await page.getByRole("button", { name: "Send to Kitchen" }).evaluate(
        (el) => (el.closest("[class*='border-l']") as HTMLElement | null)?.getBoundingClientRect().width ?? 0
      );
      expect(cartWidth, "the cart should take well under half a portrait tablet").toBeLessThan(810 * 0.4);

      await page.getByRole("button", { name: "Select a table" }).click();
      await page.getByRole("dialog").getByText(table.label, { exact: true }).click();
      await addSeedItem(page);
      await payInCash(page);
    });
  });
});
