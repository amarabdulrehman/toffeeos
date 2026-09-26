import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getAvailableTable, getMenuItemId } from "./fixtures/api";

/**
 * Changing an order after it was punched: voiding one item, switching dine-in and takeaway,
 * merging tables, tax exemption, the kitchen's recall, and opening the drawer with no sale.
 *
 * The check that matters for every change to what an order contains is the same: afterwards, the
 * order costs exactly what a fresh order of its remaining items would, priced by the same engine.
 * So each is compared against the live cart preview, not against arithmetic repeated here.
 */

interface Line {
  id: string;
  nameSnapshot: string;
  quantity: number;
  unitPricePaisa: number;
  isVoided: boolean;
}
interface Order {
  id: string;
  orderNumber: number;
  type: string;
  status: string;
  tableId: string | null;
  totalPaisa: number;
  taxPaisa: number;
  taxExemptReason: string | null;
  lines: Line[];
}

async function newOrder(
  request: APIRequestContext,
  opts: { type?: "DINE_IN" | "TAKEAWAY"; tableId?: string; lines: { name: string; quantity: number }[] }
): Promise<Order> {
  const lines = [];
  for (const l of opts.lines) lines.push({ menuItemId: await getMenuItemId(request, l.name), quantity: l.quantity });
  const res = await request.post("/api/orders", {
    data: { type: opts.type ?? "TAKEAWAY", tableId: opts.tableId, idempotencyKey: `changes-${uniqueSuffix()}`, lines },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return fetchOrder(request, (await res.json()).order.id);
}

async function fetchOrder(request: APIRequestContext, id: string): Promise<Order> {
  const res = await request.get(`/api/orders/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).order;
}

/** What a brand-new order of these items would cost, from the till's own live preview. */
async function freshPrice(request: APIRequestContext, type: string, lines: Line[]) {
  const live = lines.filter((l) => !l.isVoided);
  const res = await request.post("/api/orders/preview", {
    data: { type, lines: live.map((l) => ({ unitPricePaisa: l.unitPricePaisa, quantity: l.quantity })) },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { totalPaisa: number; taxPaisa: number };
}

async function payPreview(request: APIRequestContext, orderId: string, method: "CASH" | "CARD") {
  const res = await request.post(`/api/orders/${orderId}/pay-preview`, { data: { tenders: [{ method, amountPaisa: 0 }] } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).totals as { totalPaisa: number; taxPaisa: number };
}

async function as(baseURL: string | undefined, who: "cashier" | "waiter" | "kitchen") {
  return playwrightRequest.newContext({ baseURL, storageState: authFile(who) });
}

test.describe("Changing an order", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("voiding one of two items prices the order as if it had never been there", async ({ request }) => {
    const order = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 2 }, { name: "Dahi Bhalla", quantity: 1 }] });
    const pakora = order.lines.find((l) => l.nameSnapshot === "Fish Pakora")!;

    const res = await request.post(`/api/orders/${order.id}/lines/${pakora.id}/void`, {
      data: { quantity: 1, reason: "customer changed their mind" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const after = await fetchOrder(request, order.id);
    const live = after.lines.filter((l) => !l.isVoided);
    const voided = after.lines.filter((l) => l.isVoided);
    expect(live.find((l) => l.nameSnapshot === "Fish Pakora")?.quantity, "one pakora left").toBe(1);
    expect(voided).toHaveLength(1);
    expect(voided[0].quantity, "the one taken off is kept, marked voided").toBe(1);

    expect(after.totalPaisa, "the stored total is a fresh order of what's left").toBe((await freshPrice(request, "TAKEAWAY", after.lines)).totalPaisa);

    // And payment charges exactly that — the voided pakora is nowhere in it.
    const card = await payPreview(request, order.id, "CARD");
    const paid = await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CARD", amountPaisa: card.totalPaisa }] } });
    expect(paid.ok(), await paid.text()).toBeTruthy();
    expect((await paid.json()).order.totalPaisa).toBe(card.totalPaisa);

    // The voids report says what went and why.
    // The branch's date, not UTC's: between midnight and 5am in Karachi, UTC is still on yesterday,
    // and a report asked for "up to yesterday" doesn't have this morning's void in it.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    const report = await request.get(`/api/reports/discount-void?from=2024-01-01&to=${today}`);
    expect(report.ok(), await report.text()).toBeTruthy();
    const rows = (await report.json()).rows as { orderNumber: number; detail: string; reason: string | null }[];
    const mine = rows.find((r) => r.orderNumber === order.orderNumber && r.detail.includes("Fish Pakora"));
    expect(mine?.detail).toContain("1× Fish Pakora voided");
    expect(mine?.reason).toBe("customer changed their mind");
  });

  test("voiding refuses what it shouldn't do", async ({ request, baseURL }) => {
    const order = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 1 }] });
    const line = order.lines[0];

    const noReason = await request.post(`/api/orders/${order.id}/lines/${line.id}/void`, { data: { reason: "" } });
    expect(noReason.status(), "a void needs a reason").toBe(400);

    const last = await request.post(`/api/orders/${order.id}/lines/${line.id}/void`, { data: { reason: "last one" } });
    expect(last.status(), "the last item is a whole-order void").toBe(400);

    const waiter = await as(baseURL, "waiter");
    const denied = await waiter.post(`/api/orders/${order.id}/lines/${line.id}/void`, { data: { reason: "not mine to do" } });
    expect(denied.status(), "a waiter can't void items").toBe(403);
    await waiter.dispose();

    const two = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 1 }, { name: "Dahi Bhalla", quantity: 1 }] });
    const card = await payPreview(request, two.id, "CASH");
    await request.post(`/api/orders/${two.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: card.totalPaisa }] } });
    const afterPaid = await request.post(`/api/orders/${two.id}/lines/${two.lines[0].id}/void`, { data: { reason: "too late" } });
    expect(afterPaid.status(), "a paid order is refunded, not voided").toBe(409);
  });

  test("a table can become takeaway and back, freeing and taking tables as it goes", async ({ request }) => {
    const table = await getAvailableTable(request);
    const order = await newOrder(request, { type: "DINE_IN", tableId: table.id, lines: [{ name: "Fish Pakora", quantity: 2 }] });

    const toTakeaway = await request.post(`/api/orders/${order.id}/type`, { data: { type: "TAKEAWAY" } });
    expect(toTakeaway.ok(), await toTakeaway.text()).toBeTruthy();
    let after = await fetchOrder(request, order.id);
    expect(after.type).toBe("TAKEAWAY");
    expect(after.tableId).toBeNull();
    expect(after.totalPaisa, "priced as a takeaway now").toBe((await freshPrice(request, "TAKEAWAY", after.lines)).totalPaisa);

    const tables = await (await request.get("/api/tables")).json();
    const status = (id: string) =>
      (tables.floors as { tables: { id: string; status: string }[] }[]).flatMap((f) => f.tables).find((t) => t.id === id)?.status;
    expect(status(table.id), "the table is free again").toBe("AVAILABLE");

    const seated = await request.post(`/api/orders/${order.id}/type`, { data: { type: "DINE_IN", tableId: table.id } });
    expect(seated.ok(), await seated.text()).toBeTruthy();
    after = await fetchOrder(request, order.id);
    expect(after.type).toBe("DINE_IN");
    expect(after.tableId).toBe(table.id);
    expect(after.totalPaisa, "priced as dine-in again").toBe((await freshPrice(request, "DINE_IN", after.lines)).totalPaisa);

    const noTable = await request.post(`/api/orders/${order.id}/type`, { data: { type: "TAKEAWAY" } });
    expect(noTable.ok()).toBeTruthy();
    const sitDownWithoutTable = await request.post(`/api/orders/${order.id}/type`, { data: { type: "DINE_IN" } });
    expect(sitDownWithoutTable.status(), "dine-in needs a table").toBe(400);
  });

  test("merging two tables puts everything on one bill and frees the other table", async ({ request }) => {
    const first = await getAvailableTable(request);
    const target = await newOrder(request, { type: "DINE_IN", tableId: first.id, lines: [{ name: "Fish Pakora", quantity: 1 }] });
    const second = await getAvailableTable(request);
    const source = await newOrder(request, { type: "DINE_IN", tableId: second.id, lines: [{ name: "Dahi Bhalla", quantity: 2 }] });

    const res = await request.post(`/api/orders/${target.id}/merge`, { data: { sourceOrderId: source.id } });
    expect(res.ok(), await res.text()).toBeTruthy();

    const merged = await fetchOrder(request, target.id);
    expect(merged.lines.map((l) => l.nameSnapshot).sort()).toEqual(["Dahi Bhalla", "Fish Pakora"]);
    expect(merged.totalPaisa, "one bill, priced as one order").toBe((await freshPrice(request, "DINE_IN", merged.lines)).totalPaisa);

    const closed = await fetchOrder(request, source.id);
    expect(closed.status).toBe("CANCELLED");
    expect(closed.totalPaisa, "nothing left on it to count twice").toBe(0);
    expect(closed.lines).toHaveLength(0);

    const tables = await (await request.get("/api/tables")).json();
    const secondStatus = (tables.floors as { tables: { id: string; status: string }[] }[])
      .flatMap((f) => f.tables)
      .find((t) => t.id === second.id)?.status;
    expect(secondStatus, "the merged-in table is free").toBe("AVAILABLE");
  });

  test("a tax-exempt order is charged no tax at any step, and says why on the bill", async ({ request, baseURL }) => {
    const order = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 2 }] });
    const before = await payPreview(request, order.id, "CASH");
    expect(before.taxPaisa, "the demo branch charges tax, or this proves nothing").toBeGreaterThan(0);

    const cashier = await as(baseURL, "cashier");
    const denied = await cashier.put(`/api/orders/${order.id}/tax-exemption`, { data: { reason: "cashier try" } });
    expect(denied.status(), "exempting tax is a manager's call").toBe(403);
    await cashier.dispose();

    const noReason = await request.put(`/api/orders/${order.id}/tax-exemption`, { data: { reason: "" } });
    expect(noReason.status()).toBe(400);

    const exempt = await request.put(`/api/orders/${order.id}/tax-exemption`, { data: { reason: "Diplomatic mission 1234" } });
    expect(exempt.ok(), await exempt.text()).toBeTruthy();

    for (const method of ["CASH", "CARD"] as const) {
      const p = await payPreview(request, order.id, method);
      expect(p.taxPaisa, `no tax paying by ${method}`).toBe(0);
    }
    const bill = await (await request.get(`/api/orders/${order.id}/bill`)).json();
    expect(bill.order.taxExemptReason).toBe("Diplomatic mission 1234");
    expect((bill.bill.options as { taxPaisa: number }[]).every((o) => o.taxPaisa === 0)).toBe(true);

    // Taking it off puts the tax back exactly.
    const removed = await request.delete(`/api/orders/${order.id}/tax-exemption`);
    expect(removed.ok(), await removed.text()).toBeTruthy();
    expect((await payPreview(request, order.id, "CASH")).taxPaisa).toBe(before.taxPaisa);

    await request.put(`/api/orders/${order.id}/tax-exemption`, { data: { reason: "Diplomatic mission 1234" } });
    const cash = await payPreview(request, order.id, "CASH");
    const paid = await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: cash.totalPaisa }] } });
    expect(paid.ok(), await paid.text()).toBeTruthy();
    expect((await paid.json()).order.taxPaisa, "and payment charges none").toBe(0);
  });

  test("the kitchen can take back a ready it didn't mean", async ({ request, baseURL }) => {
    const order = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 1 }] });
    expect((await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} })).ok()).toBeTruthy();

    const kitchen = await as(baseURL, "kitchen");
    expect((await kitchen.post(`/api/orders/${order.id}/ready`)).ok()).toBeTruthy();

    const recent = await (await kitchen.get("/api/kds/recent")).json();
    expect((recent.orders as { id: string }[]).some((o) => o.id === order.id), "it is in the recall list").toBe(true);

    const recalled = await kitchen.post(`/api/orders/${order.id}/recall`);
    expect(recalled.ok(), await recalled.text()).toBeTruthy();

    const board = await (await kitchen.get("/api/kds/orders")).json();
    const back = (board.orders as { id: string; readyAt: string | null; status: string }[]).find((o) => o.id === order.id);
    expect(back, "back on the board").toBeTruthy();
    expect(back!.readyAt).toBeNull();
    expect(back!.status).toBe("SENT_TO_KITCHEN");
    await kitchen.dispose();
  });

  test("an item voided after the kitchen has it shows on the kitchen screen as voided", async ({ request }) => {
    const order = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 1 }, { name: "Dahi Bhalla", quantity: 1 }] });
    await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} });
    const dahi = order.lines.find((l) => l.nameSnapshot === "Dahi Bhalla")!;
    await request.post(`/api/orders/${order.id}/lines/${dahi.id}/void`, { data: { reason: "ran out" } });

    const board = await (await request.get("/api/kds/orders")).json();
    const ticket = (board.orders as { id: string; lines: { nameSnapshot: string; isVoided: boolean }[] }[]).find((o) => o.id === order.id);
    expect(ticket?.lines.find((l) => l.nameSnapshot === "Dahi Bhalla")?.isVoided, "the cook sees it's off").toBe(true);
  });

  test("opening the drawer with no sale is on record against today's drawer", async ({ baseURL }) => {
    const cashier = await as(baseURL, "cashier");
    const reason = `Change for a customer ${uniqueSuffix()}`;
    const res = await cashier.post("/api/cash-drawer/no-sale", { data: { reason } });
    expect(res.ok(), await res.text()).toBeTruthy();

    const day = (await (await cashier.get("/api/cash-drawer")).json()).day as { noSales: { reason: string; byName: string | null }[] };
    const mine = day.noSales.find((n) => n.reason === reason);
    expect(mine, "listed on today's drawer").toBeTruthy();
    expect(mine!.byName, "with who did it").toBeTruthy();
    await cashier.dispose();

    const waiter = await as(baseURL, "waiter");
    expect((await waiter.post("/api/cash-drawer/no-sale", { data: { reason: "waiter" } })).status()).toBe(403);
    await waiter.dispose();
  });

  test("the till's Manage button voids an item on screen", async ({ page, request }) => {
    const order = await newOrder(request, { lines: [{ name: "Fish Pakora", quantity: 1 }, { name: "Dahi Bhalla", quantity: 1 }] });

    await page.goto("/pos");
    await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Order Queue" }).click();
    const row = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
    await row.getByRole("button", { name: "Manage" }).click();

    const dialog = page.getByRole("dialog", { name: new RegExp(`Order #${order.orderNumber}`) });
    await dialog.getByRole("button", { name: "Void Dahi Bhalla" }).click();
    await dialog.getByLabel("Reason for voiding").fill("customer changed their mind");
    await dialog.getByRole("button", { name: "Yes, void it" }).click();

    await expect(dialog.getByText("(voided)")).toBeVisible({ timeout: 20_000 });
    const after = await fetchOrder(request, order.id);
    // Whole rupees, digits only — independent of how Node and the browser each format a number.
    await expect
      .poll(async () => (await dialog.getByTestId("manage-total").textContent())?.replace(/\D/g, ""))
      .toBe(String(Math.round(after.totalPaisa / 100)));
    expect(after.lines.find((l) => l.nameSnapshot === "Dahi Bhalla")?.isVoided).toBe(true);
  });
});
