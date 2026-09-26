import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";
import { withDb } from "./fixtures/platform-admin";

/**
 * The Order Queue shows today's orders.
 *
 * It used to show the branch's newest hundred orders from any day, so yesterday's paid bills sat
 * among today's. Now it is this business day's (the branch's own day: midnight, or its "day starts
 * at" time if it trades past midnight). An earlier day's order still unpaid is not dropped — a
 * table seated at 11:30pm is still eating at 12:15 — but folded away at the foot, "Earlier days ·
 * N not paid", out of the way until someone opens it.
 */

type Order = { id: string; orderNumber: number };

async function takeaway(request: APIRequestContext): Promise<Order> {
  const menuItemId = await getMenuItemId(request, "Fish Pakora");
  const res = await request.post("/api/orders", {
    data: { type: "TAKEAWAY", idempotencyKey: `queue-today-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).order;
}

async function pay(request: APIRequestContext, order: Order) {
  const preview = await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method: "CASH", amountPaisa: 0 }] } });
  const total = (await preview.json()).totals.totalPaisa as number;
  const paid = await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: total }] } });
  expect(paid.ok(), await paid.text()).toBeTruthy();
}

/** Two days ago: before today's business day however the branch's day start is set (6am at most). */
async function backdate(order: Order) {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await withDb((c) => c.query(`UPDATE "Order" SET "createdAt" = $1 WHERE id = $2`, [twoDaysAgo, order.id]));
}

async function queue(request: APIRequestContext) {
  const res = await request.get("/api/orders?day=today");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { orders: Order[]; earlierUnpaid: Order[] };
}

const numbers = (orders: Order[]) => orders.map((o) => o.orderNumber);

test.describe("The Order Queue is today's", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("yesterday's paid orders are gone, an unpaid one is folded away, today's are listed", async ({ page, request }) => {
    const oldPaid = await takeaway(request);
    await pay(request, oldPaid);
    await backdate(oldPaid);
    const oldUnpaid = await takeaway(request);
    await backdate(oldUnpaid);
    const today = await takeaway(request);

    try {
      const listed = await queue(request);
      expect(numbers(listed.orders), "today's order").toContain(today.orderNumber);
      expect(numbers(listed.orders), "not an earlier day's paid order").not.toContain(oldPaid.orderNumber);
      expect(numbers(listed.orders), "nor an earlier day's unpaid one, among today's").not.toContain(oldUnpaid.orderNumber);
      expect(numbers(listed.earlierUnpaid), "which is kept apart instead").toContain(oldUnpaid.orderNumber);
      expect(numbers(listed.earlierUnpaid), "a paid one isn't").not.toContain(oldPaid.orderNumber);

      // On the till.
      await page.goto("/pos");
      await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Order Queue" }).click();
      const rows = page.locator("div.rounded-xl");
      await expect(rows.filter({ hasText: `#${today.orderNumber} ·` }).first()).toBeVisible({ timeout: 20_000 });
      await expect(rows.filter({ hasText: `#${oldPaid.orderNumber} ·` })).toHaveCount(0);
      await expect(rows.filter({ hasText: `#${oldUnpaid.orderNumber} ·` }), "folded away").toHaveCount(0);

      const earlier = page.getByRole("button", { name: /Earlier days/ });
      await expect(earlier).toContainText("not paid");
      await earlier.click();
      await expect(rows.filter({ hasText: `#${oldUnpaid.orderNumber} ·` }).first(), "one tap away").toBeVisible();
    } finally {
      // Voided, so it doesn't sit in every later run's "earlier days".
      await request.post(`/api/orders/${oldUnpaid.id}/void`, { data: { reason: "test tidy-up" } });
      await request.post(`/api/orders/${today.id}/void`, { data: { reason: "test tidy-up" } });
    }
  });

  test("the number on the Order Queue button counts today's unpaid orders", async ({ request }) => {
    const count = async () =>
      ((await (await request.get("/api/orders/activity")).json()) as { awaitingPayment: number }).awaitingPayment;
    const before = await count();
    const order = await takeaway(request);
    try {
      expect(await count(), "a new unpaid order counts").toBe(before + 1);
      await backdate(order);
      expect(await count(), "an earlier day's doesn't").toBe(before);
    } finally {
      await request.post(`/api/orders/${order.id}/void`, { data: { reason: "test tidy-up" } });
    }
  });
});
