import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * The bill a table asks for before it pays.
 *
 * An unpaid order has no single total: Punjab's PRA charges 16% tax on cash and 8% on card, and the
 * figure stored on the order is only a provisional cash-rate estimate. So the bill prices the order
 * once per payment method. What matters most is that the figure a customer reads is the figure they
 * are then charged — asserted here against the real payment, not against a second calculation.
 */

interface BillOption {
  methods: string[];
  taxPaisa: number;
  taxRatePct: number;
  totalPaisa: number;
}

async function unpaidOrder(request: APIRequestContext, lines: { menuItemId: string; quantity: number; discount?: { type: "FIXED" | "PERCENT"; value: number } }[]) {
  const res = await request.post("/api/orders", {
    data: { type: "TAKEAWAY", idempotencyKey: `bill-${uniqueSuffix()}`, lines },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).order as { id: string; orderNumber: number; totalPaisa: number };
}

async function bill(request: APIRequestContext, orderId: string) {
  const res = await request.get(`/api/orders/${orderId}/bill`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).bill as { subtotalPaisa: number; discountPaisa: number; options: BillOption[] };
}

test.describe("Bill before payment", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("shows a total per way of paying, and each is exactly what payment charges", async ({ request }) => {
    const menuItemId = await getMenuItemId(request, "Fish Pakora");
    const order = await unpaidOrder(request, [{ menuItemId, quantity: 2 }]);

    const b = await bill(request, order.id);
    const cash = b.options.find((o) => o.methods.includes("CASH"))!;
    const card = b.options.find((o) => o.methods.includes("CARD"))!;
    expect(cash, "cash must be priced").toBeTruthy();
    expect(card, "card must be priced").toBeTruthy();
    // The demo branch carries PRA's split, so these really are two different bills.
    expect(cash.taxRatePct).toBe(16);
    expect(card.taxRatePct).toBe(8);
    expect(card.totalPaisa, "card is taxed less, so it costs less").toBeLessThan(cash.totalPaisa);

    // Each figure on the bill matches the till's own payment preview for that method...
    for (const option of [cash, card]) {
      const preview = await request.post(`/api/orders/${order.id}/pay-preview`, {
        data: { tenders: [{ method: option.methods[0], amountPaisa: 0 }] },
      });
      expect((await preview.json()).totals.totalPaisa, `${option.methods[0]} preview`).toBe(option.totalPaisa);
    }

    // ...and paying by card charges the card figure, to the paisa.
    const paid = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CARD", amountPaisa: card.totalPaisa }] },
    });
    expect(paid.ok(), await paid.text()).toBeTruthy();
    expect((await paid.json()).order.totalPaisa, "charged exactly what the bill said").toBe(card.totalPaisa);
  });

  test("a discount on one item survives through to payment", async ({ request }) => {
    /**
     * Line discounts were stored on the line and counted in the total the cart showed, then quietly
     * dropped whenever the order was priced again — previewing payment, taking it, adding a course.
     * The item was charged at full price. Nothing in the till's screens sets one today, but the
     * API accepts them, and a bill built on the same pricing would have printed the wrong figure.
     */
    const menuItemId = await getMenuItemId(request, "Fish Pakora");
    const discounted = await unpaidOrder(request, [{ menuItemId, quantity: 2, discount: { type: "FIXED", value: 10_000 } }]);
    const plain = await unpaidOrder(request, [{ menuItemId, quantity: 2 }]);

    const b = await bill(request, discounted.id);
    expect(b.discountPaisa, "the Rs 100 off the line appears on the bill").toBe(10_000);

    const cashTotal = b.options.find((o) => o.methods.includes("CASH"))!.totalPaisa;
    const plainCash = (await bill(request, plain.id)).options.find((o) => o.methods.includes("CASH"))!.totalPaisa;
    expect(cashTotal, "the discounted order must cost less than the same order without it").toBeLessThan(plainCash);

    const paid = await request.post(`/api/orders/${discounted.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: cashTotal }] },
    });
    expect(paid.ok(), await paid.text()).toBeTruthy();
    expect((await paid.json()).order.totalPaisa, "and payment honours it").toBe(cashTotal);
  });

  test("the bill button prints both totals from the Order Queue", async ({ page, request }) => {
    const menuItemId = await getMenuItemId(request, "Fish Pakora");
    const order = await unpaidOrder(request, [{ menuItemId, quantity: 1 }]);
    const sent = await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
    expect(sent.ok(), await sent.text()).toBeTruthy();

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Order Queue" }).click();

    const row = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
    await row.getByRole("button", { name: "Bill", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: new RegExp(`Bill — Order #${order.orderNumber}`) });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText("BILL", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/If paid by Cash/)).toBeVisible();
    await expect(dialog.getByText(/If paid by Card/)).toBeVisible();
    await expect(dialog.getByText("UNPAID")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Print bill" })).toBeEnabled();
  });

  test("a waiter cannot print one unless the owner allows it", async ({ baseURL, request }) => {
    // pos.receipt.print, which the seeded Waiter role does not hold. It gated nothing until now.
    const menuItemId = await getMenuItemId(request, "Fish Pakora");
    const order = await unpaidOrder(request, [{ menuItemId, quantity: 1 }]);

    const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
    const res = await waiter.get(`/api/orders/${order.id}/bill`);
    expect(res.status()).toBe(403);
    await waiter.dispose();
  });

  test("a voided order has no bill", async ({ request }) => {
    const menuItemId = await getMenuItemId(request, "Fish Pakora");
    const order = await unpaidOrder(request, [{ menuItemId, quantity: 1 }]);
    const voided = await request.post(`/api/orders/${order.id}/void`, { data: { reason: "bill spec" } });
    expect(voided.ok(), await voided.text()).toBeTruthy();

    const res = await request.get(`/api/orders/${order.id}/bill`);
    expect(res.status()).toBe(400);
  });
});
