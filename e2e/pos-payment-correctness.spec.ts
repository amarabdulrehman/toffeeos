import { test, expect } from "@playwright/test";
import { authFile, SEED_MENU_ITEM } from "./fixtures/test-data";
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
  test("switching Cash -> Card mid-payment updates the actual charged amount, not just the display", async ({ page, request }) => {
    const table = await getAvailableTable(request);

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });

    // Dine-in, pick the table, add one item.
    await page.getByRole("button", { name: "Select a table" }).click();
    await page.getByRole("dialog").getByText(table.label, { exact: true }).click();
    await page.getByRole("button", { name: SEED_MENU_ITEM.name, exact: false }).first().click();

    await expect(page.getByText("Subtotal")).toBeVisible();
    await page.getByRole("button", { name: "Take Payment" }).click();

    const dialog = page.getByRole("dialog", { name: "Take payment" });
    await expect(dialog).toBeVisible();

    // Cash first — Punjab PRA's cash rate is 16%. 480 * 1.16 = 556.8, rounded to 557.
    await expect(dialog.getByText(/incl\..*16%/)).toBeVisible();
    const cashAmountInput = dialog.locator('input[type="number"]').first();
    await expect(cashAmountInput).toHaveValue("557.00");

    // Switch to Card — the rate drops to 8%. 480 * 1.08 = 518.4, rounded to 518.
    await dialog.locator("button", { hasText: "Cash" }).click();
    await page.getByRole("option", { name: "Card" }).click();

    await expect(dialog.getByText(/incl\..*8%/)).toBeVisible();
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
});
