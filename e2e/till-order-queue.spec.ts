import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, SEED_MENU_ITEM, SEED_MENU_ITEM_2 } from "./fixtures/test-data";
import { createOrder, getAvailableTable, getMenuItemId } from "./fixtures/api";

/**
 * Three things a cashier does at the Order Queue that it could not do, or could not see:
 *
 *  - Put another round on an order already placed. The server always allowed it; the till only
 *    offered it by opening the order's table, so a takeaway or delivery order — no table to open —
 *    could not be added to at all.
 *  - Tell which table an order is for. The card said "#123 · DINE IN" and nothing else.
 *  - Know how much change to hand back. The payment dialog worked it out from "Cash given", then
 *    threw it away when it closed: nothing was sent, nothing was stored, and the receipt's Change
 *    line could never appear because the tender always equals the bill.
 */

test.use({ storageState: authFile("owner") });

type ListedOrder = {
  id: string;
  orderNumber: number;
  status: string;
  totalPaisa: number;
  lines: { quantity: number; isVoided?: boolean }[];
  table?: { label: string } | null;
  payments?: { method: string; amountPaisa: number; tenderedPaisa: number | null; changePaisa: number | null }[];
};

async function listed(request: APIRequestContext, id: string): Promise<ListedOrder> {
  const { orders } = (await (await request.get("/api/orders")).json()) as { orders: ListedOrder[] };
  const o = orders.find((x) => x.id === id);
  if (!o) throw new Error(`order ${id} not in /api/orders`);
  return o;
}

async function sendToKitchen(request: APIRequestContext, id: string) {
  const res = await request.post(`/api/orders/${id}/send-to-kitchen`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("Adding to an order already placed", () => {
  test("a takeaway order, which has no table, can take another round", async ({ request }) => {
    const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const itemB = await getMenuItemId(request, SEED_MENU_ITEM_2.name);
    const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: itemA, quantity: 1 }] });
    await sendToKitchen(request, order.id);
    const before = await listed(request, order.id);

    const res = await request.post(`/api/orders/${order.id}/lines`, {
      data: { lines: [{ menuItemId: itemB, quantity: 2 }] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const after = await listed(request, order.id);
    const live = (o: ListedOrder) => o.lines.filter((l) => !l.isVoided).reduce((a, l) => a + l.quantity, 0);
    expect(live(after)).toBe(live(before) + 2);
    expect(after.totalPaisa).toBeGreaterThan(before.totalPaisa);
  });

  test("the queue offers Add items on an open order, and opens it for that order", async ({ page, request }) => {
    const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: itemA, quantity: 1 }] });
    await sendToKitchen(request, order.id);

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Order Queue" }).click();

    const card = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
    await card.getByRole("button", { name: "Add items" }).click();
    // The add-items panel names the order it is adding to, so nobody adds to the wrong bill.
    await expect(page.getByText(new RegExp(`#${order.orderNumber}`)).first()).toBeVisible();
  });

  test("a paid order cannot be added to", async ({ request }) => {
    const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: itemA, quantity: 1 }] });
    await sendToKitchen(request, order.id);
    const fresh = await listed(request, order.id);
    const pay = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: fresh.totalPaisa }] },
    });
    expect(pay.ok(), await pay.text()).toBeTruthy();

    const res = await request.post(`/api/orders/${order.id}/lines`, {
      data: { lines: [{ menuItemId: itemA, quantity: 1 }] },
    });
    expect(res.status()).toBe(409);
  });
});

test("the Order Queue shows which table an order is for", async ({ page, request }) => {
  const table = await getAvailableTable(request);
  const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
  const order = await createOrder(request, {
    type: "DINE_IN",
    tableId: table.id,
    lines: [{ menuItemId: itemA, quantity: 1 }],
  });
  await sendToKitchen(request, order.id);

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Order Queue" }).click();

  const card = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
  await expect(card.getByText(`Table ${table.label}`, { exact: true })).toBeVisible();
});

test.describe("Cash received and change", () => {
  test("is stored on the cash payment, with the drawer keeping only the bill", async ({ request }) => {
    const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: itemA, quantity: 1 }] });
    await sendToKitchen(request, order.id);
    const preview = await (
      await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method: "CASH", amountPaisa: 0 }] } })
    ).json();
    const due: number = preview.totals.totalPaisa;
    const handedOver = Math.ceil((due + 1) / 100_000) * 100_000; // the next Rs 1,000 note above the bill

    const res = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: due }], cashTenderedPaisa: handedOver },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const paid = await listed(request, order.id);
    const cash = paid.payments!.find((p) => p.method === "CASH")!;
    expect(cash.amountPaisa, "the drawer only keeps the bill's share").toBe(due);
    expect(cash.tenderedPaisa).toBe(handedOver);
    expect(cash.changePaisa).toBe(handedOver - due);
  });

  test("refuses cash received that doesn't cover the cash part", async ({ request }) => {
    const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: itemA, quantity: 1 }] });
    await sendToKitchen(request, order.id);
    const fresh = await listed(request, order.id);

    const res = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: fresh.totalPaisa }], cashTenderedPaisa: fresh.totalPaisa - 100 },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/less than the cash part/);
  });

  test("the till announces the change once the payment goes through", async ({ page, request }) => {
    const itemA = await getMenuItemId(request, SEED_MENU_ITEM.name);
    const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: itemA, quantity: 1 }] });
    await sendToKitchen(request, order.id);

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Order Queue" }).click();
    const card = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
    await card.getByRole("button", { name: "Payment" }).click();

    const dialog = page.getByRole("dialog", { name: "Take payment" });
    await expect(dialog.getByText(/incl\./)).toBeVisible({ timeout: 10_000 }); // priced
    await dialog.getByRole("spinbutton").last().fill("5000");
    await dialog.getByRole("button", { name: "Confirm payment" }).click();

    await expect(page.getByText(/Give back Rs/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Cash received Rs\s?5,000/)).toBeVisible();
  });
});
