import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix, USERS } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";
import { withDb } from "./fixtures/platform-admin";

/**
 * A delivery order's money has to reach the sales figures however it was paid.
 *
 * Marking an order delivered used to set its status to DELIVERED unconditionally, and every sales
 * figure counts status PAID. So an order paid at the till and then delivered dropped out of the
 * takings the moment the rider confirmed drop-off; and a cash-on-delivery order, once DELIVERED, was
 * finished as far as the till was concerned and could never be paid at all. Either way the sale
 * went missing — for any café that delivers.
 */

async function deliveryOrder(request: APIRequestContext) {
  const menuItemId = await getMenuItemId(request, "Fish Pakora");
  const res = await request.post("/api/orders", {
    data: {
      type: "DELIVERY",
      deliveryAddress: "House 1, Street 2, Gulshan",
      idempotencyKey: `delivery-${uniqueSuffix()}`,
      lines: [{ menuItemId, quantity: 1 }],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const order = (await res.json()).order as { id: string; orderNumber: number };
  expect((await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} })).ok()).toBeTruthy();
  return order;
}

async function riderId(): Promise<string> {
  return withDb(async (c) => {
    const r = await c.query(`SELECT id FROM "User" WHERE email = $1`, [USERS.rider.email]);
    return r.rows[0].id as string;
  });
}

/** Assign, pick up, and drop off with the handoff code — the whole rider journey. */
async function deliver(request: APIRequestContext, baseURL: string | undefined, orderId: string) {
  const assigned = await request.post(`/api/orders/${orderId}/assign-rider`, { data: { riderId: await riderId() } });
  expect(assigned.ok(), await assigned.text()).toBeTruthy();

  const rider = await playwrightRequest.newContext({ baseURL, storageState: authFile("rider") });
  expect((await rider.post(`/api/rider/orders/${orderId}/picked-up`)).ok()).toBeTruthy();
  const code = await withDb(async (c) => (await c.query(`SELECT "deliveryOtpCode" FROM "Order" WHERE id = $1`, [orderId])).rows[0].deliveryOtpCode);
  const dropped = await rider.post(`/api/rider/orders/${orderId}/deliver`, { data: { code } });
  expect(dropped.ok(), await dropped.text()).toBeTruthy();
  await rider.dispose();
}

async function status(request: APIRequestContext, orderId: string) {
  return (await (await request.get(`/api/orders/${orderId}`)).json()).order as { status: string; paidAt: string | null; deliveredAt: string | null; totalPaisa: number };
}

async function todaysNet(request: APIRequestContext) {
  return (await (await request.get("/api/sales/day")).json()).totals.netPaisa as number;
}

test.describe("Delivery orders and the takings", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 180_000 });

  test("an order paid before it goes out stays paid, and counted, once delivered", async ({ request, baseURL }) => {
    const order = await deliveryOrder(request);
    const cash = (await (await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method: "CASH", amountPaisa: 0 }] } })).json()).totals.totalPaisa;
    expect((await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: cash }] } })).ok()).toBeTruthy();
    const before = await todaysNet(request);

    await deliver(request, baseURL, order.id);

    const after = await status(request, order.id);
    expect(after.status, "still PAID — delivering it is not a change of payment").toBe("PAID");
    expect(after.deliveredAt, "and the drop-off is recorded").toBeTruthy();
    expect(await todaysNet(request), "today's takings did not lose it").toBe(before);
  });

  test("a cash-on-delivery order is counted once the rider's cash is handed in", async ({ request, baseURL }) => {
    const order = await deliveryOrder(request);
    await deliver(request, baseURL, order.id);

    const delivered = await status(request, order.id);
    expect(delivered.status, "delivered, and not yet paid").toBe("DELIVERED");
    expect(delivered.paidAt).toBeNull();

    const before = await todaysNet(request);
    const cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    const settled = await cashier.post(`/api/orders/${order.id}/settle-delivery`);
    expect(settled.ok(), await settled.text()).toBeTruthy();
    await cashier.dispose();

    const paid = await status(request, order.id);
    expect(paid.status).toBe("PAID");
    expect(paid.deliveredAt, "the delivery is still on record").toBeTruthy();
    expect((await todaysNet(request)) - before, "and it is in today's takings").toBe(paid.totalPaisa);

    // Settling twice is not a second sale.
    const again = await request.post(`/api/orders/${order.id}/settle-delivery`);
    expect(again.status()).toBe(409);
  });

  test("only someone allowed to mark delivery cash received can do it", async ({ request, baseURL }) => {
    const order = await deliveryOrder(request);
    await deliver(request, baseURL, order.id);

    const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
    expect((await waiter.post(`/api/orders/${order.id}/settle-delivery`)).status()).toBe(403);
    await waiter.dispose();

    // Tidy: settle it, so it isn't left awaiting cash on the board for the next run.
    expect((await request.post(`/api/orders/${order.id}/settle-delivery`)).ok()).toBeTruthy();
  });
});
