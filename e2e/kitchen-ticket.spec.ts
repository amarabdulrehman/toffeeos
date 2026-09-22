import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getAvailableTable } from "./fixtures/api";

/**
 * Printing a kitchen ticket from the till.
 *
 * The ticket itself has existed since the KDS was built, but only the kitchen screen could print
 * one. That is fine for a restaurant with a display in the kitchen and no use at all to the ones
 * that do not have one — which is most small cafés. They sent an order to the kitchen and nothing
 * physical happened, so the order reached the cook by somebody shouting it.
 *
 * What matters here is not that a prompt appears. It is that the paper a cook works from carries
 * the things that change what gets made: the add-ons and the line note. Those were invisible on the
 * kitchen screen until recently, and a ticket that reprints the same omission onto paper would be
 * the same bug with a worse feedback loop — nobody notices a missing line on a slip.
 *
 * The offer is a button on the confirmation toast, not a dialog. A modal here blocked the till on
 * every order until dismissed, which the suite caught the hard way: two offline tests could not
 * click through it, and a third then failed with every table occupied, because the orders stranded
 * behind the modal never released theirs.
 */

async function buildProbeItem(request: APIRequestContext, label: string) {
  const suffix = uniqueSuffix();

  // Every step asserted: a silent failure here surfaces much later as "the dialog never opened",
  // which blames the feature for a fixture that never got built.
  async function post(path: string, data: unknown) {
    const res = await request.post(path, { data });
    expect(res.ok(), `${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  const categoryName = `E2E ${label} ${suffix}`;
  const category = await post("/api/menu", { name: categoryName });
  const categoryId = category.id ?? category.category?.id;

  const itemName = `${label} Probe ${suffix}`;
  const itemBody = await post("/api/menu-items", { categoryId, name: itemName, basePricePaisa: 50_000 });
  const menuItemId = itemBody.item?.id ?? itemBody.id;

  const group = await post("/api/modifier-groups", { name: `${label} Extras ${suffix}`, minSelect: 0, maxSelect: 1 });
  const groupId = group.group?.id ?? group.id;
  await post(`/api/modifier-groups/${groupId}/modifiers`, { name: "Extra Shot", priceDeltaPaisa: 10_000 });

  const attach = await request.put(`/api/menu-items/${menuItemId}/modifier-groups`, { data: { groupIds: [groupId] } });
  expect(attach.ok(), await attach.text()).toBeTruthy();

  return { categoryName, itemName };
}

test.describe("Kitchen ticket from the POS", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 180_000 });

  test("sending an order offers a ticket carrying its add-ons and notes", async ({ page, request }) => {
    const { categoryName, itemName } = await buildProbeItem(request, "Ticket");
    const table = await getAvailableTable(request);

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Select a table" }).click();
    await page.getByRole("dialog").getByText(table.label, { exact: true }).click();

    await page.getByRole("button", { name: categoryName, exact: false }).first().click();
    await page.getByRole("button", { name: itemName, exact: false }).first().click();
    const options = page.getByRole("dialog");
    await options.getByRole("button", { name: /Extra Shot/ }).click();
    await options.getByRole("button", { name: "Add to order" }).click();

    const note = `No sugar ${uniqueSuffix()}`;
    await page.getByRole("button", { name: `Note for ${itemName}`, exact: false }).first().click();
    await page.getByRole("textbox", { name: `Note for ${itemName}`, exact: false }).first().fill(note);

    await page.getByRole("button", { name: "Send to Kitchen" }).click();
    await expect(page.getByText(/sent to kitchen/i)).toBeVisible({ timeout: 30_000 });

    // The offer arrives beside the confirmation and leaves the till usable.
    const offer = page.getByRole("button", { name: "Print ticket" });
    await expect(offer, "the till should offer a ticket without being asked").toBeVisible({ timeout: 15_000 });
    await offer.click();

    const ticket = page.getByRole("dialog", { name: /Kitchen ticket/ });
    await expect(ticket).toBeVisible({ timeout: 15_000 });

    await expect(ticket.getByText(itemName)).toBeVisible();
    await expect(ticket.getByText("+ Extra Shot"), "the add-on changes what the cook makes").toBeVisible();
    await expect(ticket.getByText(`— ${note}`), "and so does the note").toBeVisible();

    // Positive control for the permission test below: an owner holds pos.kot.reprint, so the queue
    // must offer a way back to this ticket. Without this, asserting the cashier sees no button
    // proves nothing — a button that renders for nobody would satisfy it.
    await page.keyboard.press("Escape");
    await expect(ticket).toBeHidden();
    await page.getByRole("button", { name: "Order Queue" }).click();
    await expect(
      page.getByRole("button", { name: "Ticket", exact: true }).first(),
      "an owner can reprint a kitchen ticket"
    ).toBeVisible({ timeout: 20_000 });
  });

  test("a cashier can print a ticket but cannot reprint one", async ({ browser, baseURL, request }) => {
    /**
     * Two permissions, not one, and the split is the point. Printing at the moment an order is sent
     * is part of taking the order. Reprinting is what happens when a slip was lost — or when
     * somebody wants a second copy of an order the kitchen has already made, which is how the same
     * food goes out twice. The seeded Cashier role has the first and not the second.
     */
    const { categoryName, itemName } = await buildProbeItem(request, "TicketPerm");

    const ctx = await browser.newContext({ storageState: authFile("cashier"), baseURL });
    const cashier = await ctx.newPage();
    const table = await getAvailableTable(ctx.request);

    await cashier.goto("/pos");
    await expect(cashier.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
    await cashier.getByRole("button", { name: "Select a table" }).click();
    await cashier.getByRole("dialog").getByText(table.label, { exact: true }).click();
    await cashier.getByRole("button", { name: categoryName, exact: false }).first().click();
    await cashier.getByRole("button", { name: itemName, exact: false }).first().click();
    const options = cashier.getByRole("dialog");
    await options.getByRole("button", { name: /Extra Shot/ }).click();
    await options.getByRole("button", { name: "Add to order" }).click();

    await cashier.getByRole("button", { name: "Send to Kitchen" }).click();
    await expect(cashier.getByText(/sent to kitchen/i)).toBeVisible({ timeout: 30_000 });

    // pos.kot.print — they have it, so the ticket is offered.
    await expect(cashier.getByRole("button", { name: "Print ticket" })).toBeVisible({ timeout: 15_000 });

    // pos.kot.reprint — they do not, so the queue offers no way back to it.
    await cashier.getByRole("button", { name: "Order Queue" }).click();

    // Wait for the queue to actually have rendered an order before asserting an absence. Every
    // unpaid order in it carries a Payment button, so that is the proof it is populated — without
    // it, "no Ticket button" is satisfied by a queue that has not drawn yet, and the assertion
    // passes whether or not the permission is enforced. It did exactly that until this was added.
    await expect(cashier.getByRole("button", { name: "Payment", exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      cashier.getByRole("button", { name: "Ticket", exact: true }),
      "a cashier without pos.kot.reprint must not be able to run off another copy"
    ).toHaveCount(0);

    await ctx.close();
  });
});
