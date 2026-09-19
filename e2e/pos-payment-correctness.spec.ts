import { test, expect } from "@playwright/test";
import { authFile, SEED_MENU_CATEGORY, SEED_MENU_ITEM } from "./fixtures/test-data";
import { getAvailableTable } from "./fixtures/api";

/**
 * Regression coverage for the real overcharge bug found during manual testing: switching a
 * payment's method after the "Take payment" dialog opened (e.g. cashier defaults to Cash, customer
 * decides to pay by Card instead) recalculated the *displayed* total for Punjab PRA's split tax
 * rate (16% cash vs 8% card) but not the actual tendered amount, which stayed pinned to the first
 * total. A real order was overcharged by the difference before this was caught and fixed in
 * src/components/pos/payment-dialog.tsx. This test drives the real UI (not just the API) because
 * the bug lived entirely in client state — the server-side total was always correct.
 */
test.use({ storageState: authFile("owner") });

test.describe("POS payment — cash/card tax switching never overcharges", () => {
  // Every figure below is the bare item plus tax. A dine-in service charge would land on top of
  // all of them, so this pins it to zero for the duration rather than assuming it is.
  //
  // It used to assume. The numbers were written against production, where this branch's service
  // charge happens to have been zeroed by hand at some point — while prisma/seed.ts sets 5% on
  // dine-in. So the test passed on production for an accidental reason and failed the moment it
  // met a freshly-seeded database, which is also what it would do for any real client who charges
  // a service fee.
  let previousServiceCharge = 0;

  test.beforeAll(async ({ request }) => {
    const before = await request.get("/api/branch-settings");
    previousServiceCharge = (await before.json())?.settings?.serviceChargeBasisPoints ?? 0;
    const res = await request.patch("/api/branch-settings", { data: { serviceChargeBasisPoints: 0 } });
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.patch("/api/branch-settings", {
      data: { serviceChargeBasisPoints: previousServiceCharge },
    });
  });

  test("switching Cash -> Card mid-payment updates the actual charged amount, not just the display", async ({ page, request }) => {
    const table = await getAvailableTable(request);

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });

    // Dine-in, pick the table, add one item.
    await page.getByRole("button", { name: "Select a table" }).click();
    await page.getByRole("dialog").getByText(table.label, { exact: true }).click();
    await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
    await page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first().click();

    await expect(page.getByText("Subtotal")).toBeVisible();
    await page.getByRole("button", { name: "Take Payment" }).click();

    /**
     * Longer than the 10s default because this one click is three sequential server round trips,
     * not one: POST /api/orders, then send-to-kitchen, then GET /api/orders to load the order the
     * dialog pays. A trace of a failing run measured 6.3s + 2.0s before the third request had even
     * started, so the default budget was being spent before the dialog could possibly appear —
     * against a `npm run dev` server talking to Supabase in ap-southeast-1.
     *
     * This is not covering up a hang: the run that failed had already created the order
     * successfully ("Order #68 sent to kitchen." was on screen). The assertion was timing the
     * network, not the behaviour it exists to check — which is the tax arithmetic below, and that
     * still has to be exactly right. At 10s this failed roughly half of all runs, which is worse
     * than no test: it teaches whoever sees it that red means nothing.
     */
    const dialog = page.getByRole("dialog", { name: "Take payment" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    /**
     * Wait for the figures, not for a clock.
     *
     * The dialog appears before it knows what to charge: it opens, then asks the server for the
     * authoritative total, and the tax line and tendered amount do not exist until that answers.
     * Raising the timeout on each assertion in turn — which is what the previous fix did, and it
     * only moved the failure one line down — makes the test slower without making it certain.
     * Waiting for the response itself is both.
     */
    await page
      .waitForResponse((r) => r.url().includes("/pay-preview") && r.status() === 200, { timeout: 30_000 })
      .catch(() => {
        // Already answered before this listener attached — the assertions below still hold, and
        // failing here would report a race in the test as a defect in the product.
      });

    // Cash first — Punjab PRA's cash rate is 16%. 480 * 1.16 = 556.8, rounded to 557.
    await expect(dialog.getByText(/incl\..*16%/)).toBeVisible({ timeout: 15_000 });
    const cashAmountInput = dialog.locator('input[type="number"]').first();
    await expect(cashAmountInput).toHaveValue("557.00");

    // Switch to Card — the rate drops to 8%. 480 * 1.08 = 518.4, rounded to 518.
    await dialog.locator("button", { hasText: "Cash" }).click();
    await page.getByRole("option", { name: "Card" }).click();

    await expect(dialog.getByText(/incl\..*8%/)).toBeVisible({ timeout: 15_000 });
    // This is the exact assertion that would have caught the real bug: the input previously stayed
    // at "557.00" (the cash amount) instead of following the card rate down to "518.00".
    await expect(cashAmountInput).toHaveValue("518.00");
    await expect(cashAmountInput).toBeDisabled(); // single-tender amount is derived, not editable

    const confirmBtn = dialog.getByRole("button", { name: "Confirm payment" });
    await expect(confirmBtn).toBeEnabled();

    const [payResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/pay") && r.request().method() === "POST"),
      confirmBtn.click(),
    ]);
    const { order } = await payResponse.json();

    // The one assertion that matters most: what was actually charged equals what the order
    // actually totals — never more, never less.
    expect(order.paidPaisa).toBe(order.totalPaisa);
    expect(order.taxPaisa).toBe(3_840); // 8% of Rs 480 (48000 paisa) = 3840 paisa exactly
    expect(order.totalPaisa).toBe(51_800); // 48000 + 3840 = 51840, rounded to the nearest Rs 1
  });

  test("a note typed on a cart line reaches the order the kitchen reads", async ({ page, request }) => {
    /**
     * The other half of a gap the KDS fix exposed: OrderLine.notes has existed since the schema was
     * written, /api/orders accepts it, and the printed ticket has always rendered it — but no screen
     * anywhere let anyone type one. "No sugar" and "allergy, no peanuts" had to be shouted across a
     * kitchen, which works until it is busy, which is the only time it matters.
     *
     * Asserted on the server's copy of the order rather than on the board, because the board's
     * rendering is pinned separately in kds-and-online-ordering.spec.ts. This is the capture half.
     */
    const table = await getAvailableTable(request);
    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Select a table" }).click();
    await page.getByRole("dialog").getByText(table.label, { exact: true }).click();
    await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
    await page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first().click();

    const note = `No sugar ${Math.random().toString(36).slice(2, 7)}`;
    await page.getByRole("button", { name: `Note for ${SEED_MENU_ITEM.name}`, exact: false }).first().click();
    await page.getByRole("textbox", { name: `Note for ${SEED_MENU_ITEM.name}`, exact: false }).first().fill(note);

    await page.getByRole("button", { name: "Send to Kitchen" }).click();
    await expect(page.getByText(/Order #\d+ sent to kitchen/i)).toBeVisible({ timeout: 30_000 });

    const orders = await (await request.get("/api/orders")).json();
    const order = (orders.orders as { tableId: string; lines: { notes: string | null }[] }[]).find(
      (o) => o.tableId === table.id && o.lines.some((l) => l.notes === note)
    );
    expect(order, "the note the cashier typed must reach the order, or the kitchen never learns of it").toBeTruthy();
  });

  test("the receipt says what the extra money was for", async ({ page, request }) => {
    /**
     * /api/orders returned `lines: true` and nothing else, so the receipt had no way to know a
     * line carried add-ons. A latte with an extra shot printed as "1x Latte  Rs 600" against a
     * menu board that says Rs 500, with nothing on the slip to explain the difference. That is a
     * dispute at the counter, and the answer "trust the till" is not one.
     */
    const suffix = Math.random().toString(36).slice(2, 8);
    const categoryName = `E2E Receipt Extras ${suffix}`;
    const categoryId = (await (await request.post("/api/menu", { data: { name: categoryName } })).json()).id;
    const itemName = `Receipt Probe ${suffix}`;
    const itemBody = await (
      await request.post("/api/menu-items", { data: { categoryId, name: itemName, basePricePaisa: 50_000 } })
    ).json();
    const menuItemId = itemBody.item?.id ?? itemBody.id;
    const groupId = (
      await (await request.post("/api/modifier-groups", {
        data: { name: `Receipt Extras ${suffix}`, minSelect: 0, maxSelect: 1 },
      })).json()
    ).group.id;
    await request.post(`/api/modifier-groups/${groupId}/modifiers`, {
      data: { name: "Extra Shot", priceDeltaPaisa: 10_000 },
    });
    await request.put(`/api/menu-items/${menuItemId}/modifier-groups`, { data: { groupIds: [groupId] } });

    const table = await getAvailableTable(request);
    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Select a table" }).click();
    await page.getByRole("dialog").getByText(table.label, { exact: true }).click();

    // The grid shows one category at a time, so the pill comes before the item exists on screen.
    await page.getByRole("button", { name: categoryName, exact: false }).first().click();
    await page.getByRole("button", { name: itemName, exact: false }).first().click();
    const options = page.getByRole("dialog");
    await options.getByRole("button", { name: /Extra Shot/ }).click();
    await options.getByRole("button", { name: "Add to order" }).click();

    await page.getByRole("button", { name: "Take Payment" }).click();
    const payDialog = page.getByRole("dialog", { name: "Take payment" });
    await expect(payDialog).toBeVisible({ timeout: 30_000 });
    await page
      .waitForResponse((r) => r.url().includes("/pay-preview") && r.status() === 200, { timeout: 30_000 })
      .catch(() => {});

    const confirmBtn = payDialog.getByRole("button", { name: "Confirm payment" });
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/pay") && r.request().method() === "POST"),
      confirmBtn.click(),
    ]);

    // The receipt opens by itself once payment lands.
    const receipt = page.getByRole("dialog", { name: /Receipt/ });
    await expect(receipt).toBeVisible({ timeout: 45_000 });
    await expect(
      receipt.getByText("+ Extra Shot"),
      "the slip has to account for the difference between Rs 500 and Rs 600"
    ).toBeVisible();
  });
});
