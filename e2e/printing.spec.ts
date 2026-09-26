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
 * A test can't listen to a printer, so this checks what the printer is given: a page rule that
 * leaves the page the paper selected for the printer (portrait, no margins, so no browser header or
 * footer at the far end of the roll), and a printed document that is the ticket alone, at the top,
 * inside the paper's printable width, with the rest of the app out of the layout.
 *
 * An earlier version declared a page the ticket's exact length and checked that it did. On a real
 * printer Chrome ignored the length, centred the ticket on the printer's paper and printed its footer
 * at the far end of a three-metre roll — so the rule now checked is the one that survives that.
 *
 * The paper can be any width — 58mm, 80mm, or whatever is typed — chosen in the print dialog and
 * remembered on the device, separately for receipts and kitchen tickets.
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
    const pageRule = document.getElementById("print-page-size")?.textContent?.split("\n")[0] ?? null;
    const root = document.getElementById("print-root");
    const sheet = root?.querySelector<HTMLElement>(".print-sheet") ?? null;
    const ticket = sheet?.querySelector<HTMLElement>(".print-area") ?? null;
    const others = Array.from(document.body.children).filter((c) => c.id !== "print-root");
    return {
      pageRule,
      rootText: root?.innerText ?? null,
      // How wide the ticket prints, and whether anything in it runs past that.
      sheetWidthPx: sheet ? sheet.getBoundingClientRect().width : null,
      sheetTopPx: sheet ? sheet.getBoundingClientRect().top + window.scrollY : null,
      overflows:
        ticket && sheet ? ticket.scrollWidth > ticket.clientWidth + 1 || sheet.scrollWidth > sheet.clientWidth + 1 : null,
      // The printed content's height. (The document itself is never shorter than the test window
      // when print is only emulated, so it is the ticket container that is measured.)
      printedHeightPx: root ? root.getBoundingClientRect().height : null,
      everythingElseGone: others.every((c) => getComputedStyle(c).display === "none"),
    };
  });
  await page.emulateMedia({ media: "screen" });
  return printed;
}

function expectOneTicketSizedPage(printed: Awaited<ReturnType<typeof whatPrints>>, paperMm = 80) {
  // No declared size: Chrome prints on the paper selected for the printer whatever the page says,
  // and a declared size is centred on that paper with the browser's header and footer around it —
  // the footer three metres down a roll printer's default paper, which the printer feeds to reach.
  // No margins, so there is nowhere for that header and footer; portrait, so never sideways.
  expect(printed.pageRule, "the paper is the page: portrait, no margins, no declared size").toBe(
    "@page { size: portrait; margin: 0; }"
  );
  expect(printed.everythingElseGone, "nothing but the ticket is laid out").toBe(true);
  expect(printed.printedHeightPx, "the ticket is laid out for print").toBeGreaterThan(0);
  expect(printed.sheetTopPx, "at the very top of the paper").toBe(0);
  // Inside the paper, clear of the edges a roll printer can't reach, and nothing running past it.
  const printedWidthMm = printed.sheetWidthPx! * PX_TO_MM;
  expect(printedWidthMm, "the ticket fits the paper's printable width").toBeLessThanOrEqual(paperMm - 9.9);
  expect(printedWidthMm, "and uses it").toBeGreaterThan(Math.min(paperMm - 10, 104) - 0.5);
  expect(printed.overflows, "nothing in the ticket runs off the paper").toBe(false);
  return printed.printedHeightPx! * PX_TO_MM;
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

async function openBill(page: Page, orderNumber: number) {
  const row = await openQueueRow(page, orderNumber);
  await row.getByRole("button", { name: "Bill", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`Bill — Order #${orderNumber}`) });
  await expect(dialog.getByText("BILL", { exact: true })).toBeVisible({ timeout: 20_000 });
  return dialog;
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
    // The printer's own paper size is the till's to set; the steps are beside the Print button.
    await dialog.getByText("Printer keeps feeding blank paper?").click();
    await expect(dialog.getByText("Printing preferences")).toBeVisible();
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

  test("a 58mm printer: the bill fits the narrower paper, and the device remembers it", async ({ page }) => {
    await interceptPrint(page);
    const order = await queuedOrder(page);
    let dialog = await openBill(page, order.orderNumber);
    await expect(dialog.getByRole("button", { name: "80 mm" }), "80mm until told otherwise").toHaveAttribute("aria-pressed", "true");
    const at80 = (await dialog.locator(".print-area").boundingBox())!.width;

    await dialog.getByRole("button", { name: "58 mm" }).click();
    // The preview wraps where the paper will: narrower than the 80mm layout.
    await expect.poll(async () => (await dialog.locator(".print-area").boundingBox())!.width).toBeLessThan(at80 - 5);
    await dialog.getByRole("button", { name: "Print bill" }).click();
    const printed = await whatPrints(page);
    expectOneTicketSizedPage(printed, 58);
    expect(printed.rootText).toContain(`Order #${order.orderNumber}`);

    // Remembered on this device...
    await page.reload();
    dialog = await openBill(page, order.orderNumber);
    await expect(dialog.getByRole("button", { name: "58 mm" })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "Close" }).last().click();

    // ...for receipts. The kitchen ticket has its own printer, and its own width.
    const row = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
    await row.getByRole("button", { name: "Ticket", exact: true }).click();
    const kot = page.getByRole("dialog", { name: new RegExp(`Kitchen ticket — Order #${order.orderNumber}`) });
    await expect(kot.getByRole("button", { name: "80 mm" })).toHaveAttribute("aria-pressed", "true");
    await kot.getByRole("button", { name: "Print" }).click();
    expectOneTicketSizedPage(await whatPrints(page), 80);
  });

  test("any other width can be typed in, and prints at exactly that width", async ({ page }) => {
    await interceptPrint(page);
    const order = await queuedOrder(page);
    const dialog = await openBill(page, order.orderNumber);
    await dialog.getByRole("button", { name: "Print bill" }).click();
    const at80 = expectOneTicketSizedPage(await whatPrints(page), 80);

    await dialog.getByRole("button", { name: "Other" }).click();
    const width = dialog.getByLabel("Paper width in millimetres");

    // A narrow 44mm roll: smaller type, and the lines wrap rather than run off it.
    await width.fill("44");
    await dialog.getByRole("button", { name: "Print bill" }).click();
    expectOneTicketSizedPage(await whatPrints(page), 44);

    // A wide 112mm roll: the usual type, more on each line — so never a longer ticket than 80mm.
    await width.fill("112");
    await dialog.getByRole("button", { name: "Print bill" }).click();
    const wide = expectOneTicketSizedPage(await whatPrints(page), 112);
    expect(wide, "no more paper than on an 80mm roll (to within a line's rounding)").toBeLessThanOrEqual(at80 + 1);

    // Something no printer takes is refused, and printing stays on the last good width.
    await width.fill("7");
    await expect(dialog.getByRole("alert")).toContainText("40 to 210");
    await dialog.getByRole("button", { name: "Print bill" }).click();
    expectOneTicketSizedPage(await whatPrints(page), 112);
  });

  test("the day summary prints on any width too", async ({ page }) => {
    await page.goto("/app/sales");
    await page.getByRole("button", { name: "Print day summary" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("NET SALES")).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Other" }).click();
    await dialog.getByLabel("Paper width in millimetres").fill("76");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    expectOneTicketSizedPage(await whatPrints(page), 76);
  });
});
