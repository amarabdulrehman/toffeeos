import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, SEED_MENU_ITEM, SEED_MENU_ITEM_2 } from "./fixtures/test-data";
import { createOrder, getAvailableTable, getMenuItemId } from "./fixtures/api";
import { withDb } from "./fixtures/platform-admin";

/**
 * Complimentary, item refunds and voiding one item — what a café asked for.
 *
 * Complimentary is not a payment method. A "Complimentary" tender would record money that never
 * came in, so the day's takings and the P&L would show sales that weren't. A free item is priced at
 * nothing, kept at its menu value apart from sales, and still made (stock still comes out). Cashiers
 * may give it, always with a reason.
 *
 * Refunding items works the amount out on the server from what was paid, so refunding one of two
 * equal items gives back exactly half, tax and all, and the same item can't be refunded twice.
 */

test.describe.configure({ timeout: 180_000 });

interface Line {
  id: string;
  nameSnapshot: string;
  quantity: number;
  unitPricePaisa: number;
  lineTotalPaisa: number;
  isVoided: boolean;
  isComplimentary: boolean;
  compValuePaisa: number | null;
  compReason: string | null;
  refundedQuantity: number;
}
interface Order {
  id: string;
  orderNumber: number;
  status: string;
  totalPaisa: number;
  paidPaisa: number;
  refundedPaisa: number;
  subtotalPaisa: number;
  lines: Line[];
  payments?: { method: string; amountPaisa: number }[];
}

async function fetchOrder(request: APIRequestContext, id: string): Promise<Order> {
  const { orders } = (await (await request.get("/api/orders")).json()) as { orders: Order[] };
  const o = orders.find((x) => x.id === id);
  if (!o) throw new Error(`order ${id} not in /api/orders`);
  return o;
}

async function sentOrder(request: APIRequestContext, lines: { menuItemId: string; quantity: number }[]) {
  const order = await createOrder(request, { type: "TAKEAWAY", lines });
  const sent = await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
  expect(sent.ok(), await sent.text()).toBeTruthy();
  return order;
}

async function cleanup(request: APIRequestContext, id: string) {
  const o = await fetchOrder(request, id).catch(() => null);
  if (o && o.status !== "PAID") await request.post(`/api/orders/${id}/void`, { data: { reason: "E2E cleanup" } });
}

test.describe("Complimentary", () => {
  test.use({ storageState: authFile("cashier") });

  test("a cashier gives one item free from the payment window and takes payment for the rest", async ({ page, request }) => {
    const kebab = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const bhalla = await getMenuItemId(request, SEED_MENU_ITEM_2.name);
    const order = await sentOrder(request, [
      { menuItemId: kebab, quantity: 1 },
      { menuItemId: bhalla, quantity: 2 },
    ]);
    try {
      await page.goto("/pos");
      await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Order Queue" }).click();
      const card = page.locator("div.rounded-xl.border").filter({ hasText: `#${order.orderNumber} · ` }).last();
      await card.getByRole("button", { name: "Payment", exact: true }).click();

      await page.getByRole("button", { name: "Complimentary" }).click();
      const panel = page.getByRole("dialog", { name: /Complimentary — order/ });
      await panel.getByRole("button", { name: "Some items" }).click();
      await panel.getByRole("button", { name: `One more ${SEED_MENU_ITEM_2.name} free` }).click();
      const give = panel.getByRole("button", { name: "Give free" });
      await expect(give, "no reason, no comp").toBeDisabled();
      await panel.getByRole("button", { name: "Sorry for the wait" }).click();
      await give.click();

      // Back on the payment window, with the free item named and the rest to pay.
      const pay = page.getByRole("dialog", { name: "Take payment" });
      await expect(pay.getByTestId("comped-items")).toContainText(`1× ${SEED_MENU_ITEM_2.name}`, { timeout: 20_000 });
      await pay.getByRole("button", { name: "Confirm payment" }).click();
      await expect(page.getByText(`Order #${order.orderNumber} paid.`)).toBeVisible({ timeout: 30_000 });

      const paid = await fetchOrder(request, order.id);
      expect(paid.status).toBe("PAID");
      const free = paid.lines.filter((l) => l.isComplimentary);
      expect(free).toHaveLength(1);
      expect(free[0]).toMatchObject({ quantity: 1, lineTotalPaisa: 0, compValuePaisa: SEED_MENU_ITEM_2.pricePaisa, compReason: "Sorry for the wait" });
      // Charged for the kebab and one bhalla, nothing for the free one.
      expect(paid.subtotalPaisa).toBe(SEED_MENU_ITEM.pricePaisa + SEED_MENU_ITEM_2.pricePaisa);
      expect(paid.paidPaisa).toBe(paid.totalPaisa);
    } finally {
      await cleanup(request, order.id);
    }
  });

  test("giving the whole bill settles it at nothing, and the day's figures show it apart from sales", async ({ request, baseURL }) => {
    const kebab = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await sentOrder(request, [{ menuItemId: kebab, quantity: 2 }]);
    const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    try {
      const before = (await (await owner.get("/api/sales/day")).json()).totals;

      // A reason is required.
      expect((await request.post(`/api/orders/${order.id}/comp`, { data: { reason: "" } })).status()).toBe(400);

      const res = await request.post(`/api/orders/${order.id}/comp`, { data: { reason: "Owner's guest" } });
      expect(res.ok(), await res.text()).toBeTruthy();
      expect((await res.json()).settled).toBe(true);

      const done = await fetchOrder(request, order.id);
      expect(done).toMatchObject({ status: "PAID", totalPaisa: 0, paidPaisa: 0 });
      expect(done.payments ?? [], "no money was taken, so no payment is recorded").toHaveLength(0);

      const after = (await (await owner.get("/api/sales/day")).json()).totals;
      expect(after.complimentary.valuePaisa - before.complimentary.valuePaisa).toBe(2 * SEED_MENU_ITEM.pricePaisa);
      expect(after.netPaisa, "nothing given free counts as a sale").toBe(before.netPaisa);

      // The close-the-day screen's takings carry it too, beside the payment methods.
      const drawer = (await (await request.get("/api/cash-drawer")).json()).day;
      expect(drawer.takings.complimentary.valuePaisa).toBeGreaterThanOrEqual(2 * SEED_MENU_ITEM.pricePaisa);
      expect(Array.isArray(drawer.takings.byMethod)).toBe(true);

      // And the owner's audit list says who gave it and why.
      const today = new Date().toISOString().slice(0, 10);
      const audit = await (await owner.get(`/api/reports/discount-void?from=${today}&to=${today}`)).json();
      const rows = audit.rows as { kind: string; orderNumber: number; reason: string | null }[];
      expect(rows.some((r) => r.kind === "complimentary" && r.orderNumber === order.orderNumber && r.reason === "Owner's guest")).toBe(true);
    } finally {
      await owner.dispose();
      await cleanup(request, order.id);
    }
  });

  test("a waiter can't give anything free", async ({ baseURL, request }) => {
    const kebab = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await sentOrder(request, [{ menuItemId: kebab, quantity: 1 }]);
    const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
    try {
      expect((await waiter.post(`/api/orders/${order.id}/comp`, { data: { reason: "Friend" } })).status()).toBe(403);
    } finally {
      await waiter.dispose();
      await cleanup(request, order.id);
    }
  });
});

test.describe("Refunding items", () => {
  test.use({ storageState: authFile("owner") });

  test("refunding items gives back their share of what was paid, and never the same item twice", async ({ page, request }) => {
    const kebab = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const bhalla = await getMenuItemId(request, SEED_MENU_ITEM_2.name);
    const order = await sentOrder(request, [
      { menuItemId: kebab, quantity: 2 },
      { menuItemId: bhalla, quantity: 1 },
    ]);
    const unpaid = await fetchOrder(request, order.id);
    const paidRes = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: unpaid.totalPaisa }] },
    });
    expect(paidRes.ok(), await paidRes.text()).toBeTruthy();
    const paid = await fetchOrder(request, order.id);
    const kebabLine = paid.lines.find((l) => l.nameSnapshot === SEED_MENU_ITEM.name)!;
    const bhallaLine = paid.lines.find((l) => l.nameSnapshot === SEED_MENU_ITEM_2.name)!;
    const subtotal = 2 * SEED_MENU_ITEM.pricePaisa + SEED_MENU_ITEM_2.pricePaisa;
    const oneKebab = Math.round((paid.paidPaisa * SEED_MENU_ITEM.pricePaisa) / subtotal);

    // Through the till: the dialog shows the exact amount before anyone presses Refund.
    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Order Queue" }).click();
    const card = page.locator("div.rounded-xl.border").filter({ hasText: `#${order.orderNumber} · ` }).last();
    await card.getByRole("button", { name: "Refund" }).click();
    const dialog = page.getByRole("dialog", { name: /Refund — order/ });
    await dialog.getByRole("button", { name: "Items" }).click();
    await dialog.getByRole("button", { name: `One more ${SEED_MENU_ITEM.name} to refund` }).click();
    // The same figure the server will take, formatted the way the till formats money.
    const shown = `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(oneKebab / 100)}`;
    await expect(dialog.getByTestId("item-refund-amount")).toContainText(shown);
    await dialog.getByLabel("Reason").fill("Sent back cold");
    await dialog.getByRole("button", { name: "Refund", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    let now = await fetchOrder(request, order.id);
    expect(now.refundedPaisa).toBe(oneKebab);
    expect(now.lines.find((l) => l.id === kebabLine.id)?.refundedQuantity).toBe(1);

    // Two more kebabs than are left: refused, and nothing changes.
    const tooMany = await request.post(`/api/orders/${order.id}/refund`, {
      data: { items: [{ lineId: kebabLine.id, quantity: 2 }], method: "CASH", reason: "x" },
    });
    expect(tooMany.status()).toBe(400);

    // The rest of everything: whatever is left, to the paisa, so nothing is stranded by rounding.
    const rest = await request.post(`/api/orders/${order.id}/refund`, {
      data: {
        items: [
          { lineId: kebabLine.id, quantity: 1 },
          { lineId: bhallaLine.id, quantity: 1 },
        ],
        method: "CASH",
        reason: "Whole table left",
      },
    });
    expect(rest.ok(), await rest.text()).toBeTruthy();
    now = await fetchOrder(request, order.id);
    expect(now.refundedPaisa).toBe(now.paidPaisa);
    const again = await request.post(`/api/orders/${order.id}/refund`, {
      data: { items: [{ lineId: bhallaLine.id, quantity: 1 }], method: "CASH", reason: "x" },
    });
    expect(again.status(), "the same item can't be refunded twice").toBe(400);
  });
});

test.describe("Voiding one item", () => {
  test.use({ storageState: authFile("cashier") });

  test("an item is voided straight from the table's order, with a reason", async ({ page, request }) => {
    const kebab = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const bhalla = await getMenuItemId(request, SEED_MENU_ITEM_2.name);
    const table = await getAvailableTable(request);
    const order = await createOrder(request, {
      type: "DINE_IN",
      tableId: table.id,
      lines: [
        { menuItemId: kebab, quantity: 1 },
        { menuItemId: bhalla, quantity: 1 },
      ],
    });
    await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
    try {
      await page.goto("/pos");
      await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Select a table" }).click();
      await page.getByRole("dialog").getByText(table.label, { exact: true }).click();

      await page.getByRole("button", { name: `Void ${SEED_MENU_ITEM_2.name}` }).click();
      const yes = page.getByRole("button", { name: "Yes, void it" });
      await expect(yes, "not without a reason").toBeDisabled();
      await page.getByLabel("Reason for voiding").fill("Changed their mind");
      await yes.click();
      await expect(page.getByText("Item voided.")).toBeVisible({ timeout: 20_000 });

      const now = await fetchOrder(request, order.id);
      expect(now.lines.find((l) => l.nameSnapshot === SEED_MENU_ITEM_2.name)?.isVoided).toBe(true);
      expect(now.subtotalPaisa).toBe(SEED_MENU_ITEM.pricePaisa);

      // The queue offers it too, by name, for orders that aren't on a table.
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "Order Queue" }).click();
      const card = page.locator("div.rounded-xl.border").filter({ hasText: `#${order.orderNumber} · ` }).last();
      await expect(card.getByRole("button", { name: "Void item" })).toBeVisible({ timeout: 20_000 });
    } finally {
      await cleanup(request, order.id);
    }
  });
});

test.describe("Editing a paid order", () => {
  test.use({ storageState: authFile("cashier") });

  async function paidInCash(request: APIRequestContext) {
    const kebab = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await sentOrder(request, [{ menuItemId: kebab, quantity: 1 }]);
    const preview = async (method: string) =>
      (await (await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method, amountPaisa: 1 }] } })).json()).totals
        .totalPaisa as number;
    const cashTotal = await preview("CASH");
    const cardTotal = await preview("CARD");
    const res = await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: cashTotal }] } });
    expect(res.ok(), await res.text()).toBeTruthy();
    return { order, cashTotal, cardTotal };
  }

  test("a cashier corrects Cash to Card on today's bill, priced again at the card rate", async ({ page, request }) => {
    const { order, cashTotal, cardTotal } = await paidInCash(request);

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Order Queue" }).click();
    const card = page.locator("div.rounded-xl.border").filter({ hasText: `#${order.orderNumber} · ` }).last();
    await card.getByRole("button", { name: "Edit", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: /Edit paid order/ });
    await dialog.getByRole("button", { name: "Card", exact: true }).click();
    const change = dialog.getByRole("button", { name: "Change to Card" });
    await expect(change, "not without a reason").toBeDisabled();
    await dialog.getByLabel("Reason for changing the payment method").fill("Pressed cash, paid by card");
    await change.click();
    await expect(dialog.getByTestId("payment-corrected")).toContainText("Changed from Cash to Card", { timeout: 20_000 });

    const now = await fetchOrder(request, order.id);
    expect(now.payments).toEqual([expect.objectContaining({ method: "CARD", amountPaisa: cardTotal })]);
    expect(now.totalPaisa).toBe(cardTotal);
    expect(now.paidPaisa).toBe(cardTotal);
    if (cardTotal !== cashTotal) {
      await expect(dialog.getByTestId("payment-corrected")).toContainText(cardTotal < cashTotal ? "give back" : "Collect");
    }
  });

  test("an earlier day's bill needs a manager, and split or refunded bills are refused", async ({ request, baseURL }) => {
    const { order } = await paidInCash(request);
    const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    try {
      await withDb((c) => c.query(`UPDATE "Order" SET "paidAt" = "paidAt" - interval '2 days' WHERE id = $1`, [order.id]));
      const asCashier = await request.post(`/api/orders/${order.id}/payment-method`, { data: { method: "CARD", reason: "Wrong method" } });
      expect(asCashier.status(), "a cashier can't change a day someone has signed off").toBe(403);
      const asOwner = await owner.post(`/api/orders/${order.id}/payment-method`, { data: { method: "CARD", reason: "Wrong method" } });
      expect(asOwner.ok(), await asOwner.text()).toBeTruthy();

      // Once money has gone back, which money moved is ambiguous: refused.
      const refund = await owner.post(`/api/orders/${order.id}/refund`, { data: { amountPaisa: 100, method: "CARD", reason: "E2E" } });
      expect(refund.ok(), await refund.text()).toBeTruthy();
      const afterRefund = await owner.post(`/api/orders/${order.id}/payment-method`, { data: { method: "CASH", reason: "Wrong method" } });
      expect(afterRefund.status()).toBe(409);
    } finally {
      await owner.dispose();
    }
  });

  test("a customer can be added to a bill paid without one, once", async ({ request }) => {
    const { order } = await paidInCash(request);
    const phone = `0398${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const { customer } = await (await request.post("/api/customers/find-or-create", { data: { phone, name: "E2E Late Loyalty" } })).json();
    try {
      const add = await request.post(`/api/orders/${order.id}/customer`, { data: { customerId: customer.id } });
      expect(add.ok(), await add.text()).toBeTruthy();
      const now = (await fetchOrder(request, order.id)) as Order & { customerId?: string | null };
      expect(now.customerId).toBe(customer.id);
      const again = await request.post(`/api/orders/${order.id}/customer`, { data: { customerId: customer.id } });
      expect(again.status(), "moving a bill between customers would move their points").toBe(409);
    } finally {
      await withDb(async (c) => {
        await c.query('UPDATE "Order" SET "customerId" = NULL WHERE id = $1', [order.id]);
        await c.query('DELETE FROM "LoyaltyTransaction" WHERE "customerId" = $1', [customer.id]);
        await c.query('DELETE FROM "Customer" WHERE id = $1', [customer.id]);
      });
    }
  });
});
