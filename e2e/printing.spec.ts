import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * A ticket prints as one page exactly its own length — and nothing else prints with it.
 *
 * A receipt printer kept feeding paper after every receipt and kitchen ticket. The page never
 * declared a size, so the printer's driver used its default "page", several metres of roll; and the
 * rest of the app was only made invisible for printing, so it still filled the printed document.
 *
 * A test can't listen to a printer, so this checks the two things the printer is actually given:
 * the page size (80mm by the ticket's length, not metres), and the printed document (the ticket
 * alone, fitting on that one page, with the rest of the app out of the layout).
 */

const PX_TO_MM = 25.4 / 96;

/** Replaces window.print with a recorder, so the test can inspect what would have been printed. */
async function interceptPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => {
      const w = window as unknown as { __printCalls?: number };
      w.__printCalls = (w.__printCalls ?? 0) + 1;
    };
  });
}

/** Everything the printer would receive, read in print media. */
async function whatPrints(page: Page) {
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(() => {
    const pageRule = document.getElementById("print-page-size")?.textContent ?? null;
    const root = document.getElementById("print-root");
    const others = Array.from(document.body.children).filter((c) => c.id !== "print-root");
    return {
      pageRule,
      rootText: root?.innerText ?? null,
      // The printed content's height. (The document itself is never shorter than the test window
      // when print is only emulated, so it is the ticket container that is measured.)
      printedHeightPx: root ? root.getBoundingClientRect().height : null,
      everythingElseGone: others.every((c) => getComputedStyle(c).display === "none"),
    };
  });
  await page.emulateMedia({ media: "screen" });
  return printed;
}

function expectOneTicketSizedPage(printed: Awaited<ReturnType<typeof whatPrints>>) {
  expect(printed.pageRule, "the page size is declared").toMatch(/@page \{ size: 80mm \d+mm; margin: 0; \}/);
  const heightMm = Number(printed.pageRule!.match(/80mm (\d+)mm/)![1]);
  expect(heightMm, "a ticket's length, not metres of roll").toBeLessThan(400);
  expect(heightMm).toBeGreaterThan(20);
  expect(printed.everythingElseGone, "nothing but the ticket is laid out").toBe(true);
  expect(printed.printedHeightPx, "the ticket is laid out for print").toBeGreaterThan(0);
  expect(printed.printedHeightPx! * PX_TO_MM, "and fits on that one page").toBeLessThanOrEqual(heightMm);
}

async function queuedOrder(page: Page) {
  const request = page.request;
  const menuItemId = await getMenuItemId(request, "Fish Pakora");
  const res = await request.post("/api/orders", {
    data: { type: "TAKEAWAY", idempotencyKey: `print-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 2 }] },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const order = (await res.json()).order as { id: string; orderNumber: number };
  expect((await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} })).ok()).toBeTruthy();
  return order;
}

async function openQueueRow(page: Page, orderNumber: number) {
  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Order Queue" }).click();
  return page.locator("div.rounded-xl", { hasText: `#${orderNumber}` }).first();
}

test.describe("Printing a ticket", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("a bill prints as one page its own length, with nothing else on it", async ({ page }) => {
    await interceptPrint(page);
    const order = await queuedOrder(page);
    const row = await openQueueRow(page, order.orderNumber);
    await row.getByRole("button", { name: "Bill", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(`Bill — Order #${order.orderNumber}`) });
    await expect(dialog.getByText("BILL", { exact: true })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Print bill" }).click();

    const printed = await whatPrints(page);
    expectOneTicketSizedPage(printed);
    expect(printed.rootText, "and it is this order's bill").toContain(`Order #${order.orderNumber}`);
  });

  test("a kitchen ticket prints the same way", async ({ page }) => {
    await interceptPrint(page);
    const order = await queuedOrder(page);
    const row = await openQueueRow(page, order.orderNumber);
    await row.getByRole("button", { name: "Ticket", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(`Kitchen ticket — Order #${order.orderNumber}`) });
    await dialog.getByRole("button", { name: "Print" }).click();

    const printed = await whatPrints(page);
    expectOneTicketSizedPage(printed);
    expect(printed.rootText).toContain(`#${order.orderNumber}`);
  });

  test("the browser's own Print gets the same treatment, and an ordinary page prints normally", async ({ page }) => {
    await page.goto("/app/sales");
    await page.getByRole("button", { name: "Print day summary" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("NET SALES")).toBeVisible({ timeout: 20_000 });

    // Ctrl+P, or the share sheet, fires beforeprint before laying the page out for print.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    expectOneTicketSizedPage(await whatPrints(page));

    // With no ticket on screen, printing the page is printing the page.
    await dialog.getByRole("button", { name: "Close" }).last().click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    const plain = await whatPrints(page);
    expect(plain.pageRule, "no ticket page size is left behind").toBeNull();
    expect(plain.everythingElseGone, "and the page itself prints").toBe(false);
  });
});
