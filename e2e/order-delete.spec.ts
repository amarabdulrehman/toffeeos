import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { authFile, DEMO_PASSWORD, TENANT_SLUG, SEED_MENU_ITEM, uniqueSuffix } from "./fixtures/test-data";
import { createOrder, getAvailableTable, getMenuItemId } from "./fixtures/api";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * The owner deleting an order.
 *
 * A client asked for it: wrong orders, test orders, duplicates. It is also what a tax authority
 * calls sales suppression, so most of what is pinned here is the safety around it — the platform
 * switch, owner only, the password, a reason, and a log the app itself cannot alter — and that a
 * deleted order really leaves every figure, money in and money out together.
 */

test.use({ storageState: authFile("owner") });
test.describe.configure({ mode: "serial" });

let tenantId: string;
let originalModules: string[];

async function setFeature(on: boolean) {
  await withDb(async (c) => {
    const { rows } = await c.query('SELECT "enabledModules" FROM "Subscription" WHERE "tenantId" = $1', [tenantId]);
    const current: string[] = rows[0].enabledModules;
    const next = on ? [...new Set([...current, "orderDelete"])] : current.filter((m) => m !== "orderDelete");
    await c.query('UPDATE "Subscription" SET "enabledModules" = $1 WHERE "tenantId" = $2', [next, tenantId]);
  });
}

async function paidOrder(request: APIRequestContext) {
  const item = await getMenuItemId(request, SEED_MENU_ITEM.name);
  const order = await createOrder(request, { type: "TAKEAWAY", lines: [{ menuItemId: item, quantity: 1 }] });
  expect((await request.post(`/api/orders/${order.id}/send-to-kitchen`)).ok()).toBeTruthy();
  const preview = await (
    await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method: "CASH", amountPaisa: 0 }] } })
  ).json();
  const due: number = preview.totals.totalPaisa;
  const pay = await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: due }] } });
  expect(pay.ok(), await pay.text()).toBeTruthy();
  return { ...order, totalPaisa: due };
}

function del(request: APIRequestContext, orderId: string, body: Record<string, unknown>) {
  return request.post(`/api/orders/${orderId}/delete`, { data: body });
}

const today = () => new Date().toISOString().slice(0, 10);

test.beforeAll(async () => {
  await withDb(async (c) => {
    tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
    originalModules = (await c.query('SELECT "enabledModules" FROM "Subscription" WHERE "tenantId" = $1', [tenantId])).rows[0]
      .enabledModules;
  });
});

test.afterAll(async () => {
  // Leave the demo restaurant exactly as it was, and give back the password attempts this used.
  await withDb(async (c) => {
    await c.query('UPDATE "Subscription" SET "enabledModules" = $1 WHERE "tenantId" = $2', [originalModules, tenantId]);
    await c.query(`DELETE FROM "RateLimitHit" WHERE key LIKE 'order-delete-auth:%'`);
  });
});

test("refused until the platform switches it on for the restaurant", async ({ request }) => {
  await setFeature(false);
  const order = await paidOrder(request);
  const res = await del(request, order.id, { reason: "test order", password: DEMO_PASSWORD });
  expect(res.status()).toBe(403);
  expect(await res.text()).toMatch(/isn't turned on/);
});

test("a manager can't delete, even with it switched on", async ({ browser, baseURL, request }) => {
  await setFeature(true);
  const order = await paidOrder(request);
  const ctx = await browser.newContext({ baseURL, storageState: authFile("manager") });
  try {
    const res = await del(ctx.request, order.id, { reason: "test order", password: DEMO_PASSWORD });
    expect(res.status()).toBe(403);
    expect(await res.text()).toMatch(/Only the restaurant owner/);
  } finally {
    await ctx.close();
  }
});

test("needs the owner's real password, and a reason", async ({ request }) => {
  await setFeature(true);
  const order = await paidOrder(request);

  const wrong = await del(request, order.id, { reason: "test order", password: "not-the-password" });
  expect(wrong.status()).toBe(401);
  const noReason = await del(request, order.id, { reason: "", password: DEMO_PASSWORD });
  expect(noReason.status()).toBe(400);

  const stillThere = await withDb(async (c) =>
    (await c.query('SELECT status FROM "Order" WHERE id = $1', [order.id])).rows[0].status
  );
  expect(stillThere, "a refused delete changes nothing").toBe("PAID");
});

test("a paid order leaves sales and the drawer, and the log keeps what it was", async ({ request }) => {
  await setFeature(true);
  const order = await paidOrder(request);
  const qs = `from=${today()}&to=${today()}`;
  const salesBefore = (await (await request.get(`/api/reports/transactions?${qs}`)).json()).totalPaisa as number;
  const cashBefore = (await (await request.get("/api/cash-drawer")).json()).day.cashSalesPaisa as number;

  const reason = `entered twice ${uniqueSuffix()}`;
  const res = await del(request, order.id, { reason, password: DEMO_PASSWORD, restock: true });
  expect(res.ok(), await res.text()).toBeTruthy();

  const tx = await (await request.get(`/api/reports/transactions?${qs}`)).json();
  expect(tx.totalPaisa, "sales drop by exactly this order").toBe(salesBefore - order.totalPaisa);
  expect((tx.rows as { orderId: string }[]).some((r) => r.orderId === order.id)).toBe(false);
  const cashAfter = (await (await request.get("/api/cash-drawer")).json()).day.cashSalesPaisa as number;
  expect(cashAfter, "and its cash leaves the drawer's expected figure").toBe(cashBefore - order.totalPaisa);

  const { orders } = await (await request.get("/api/orders?day=today")).json();
  expect((orders as { id: string }[]).some((o) => o.id === order.id), "gone from the Order Queue").toBe(false);

  const { deletions } = await (await request.get("/api/orders/deletions")).json();
  const entry = (deletions as { orderId: string; reason: string; totalPaisa: number; previousStatus: string; restocked: boolean; payments: { method: string }[] }[]).find(
    (d) => d.orderId === order.id
  );
  expect(entry?.reason).toBe(reason);
  expect(entry?.totalPaisa).toBe(order.totalPaisa);
  expect(entry?.previousStatus).toBe("PAID");
  expect(entry?.restocked).toBe(true);
  expect(entry?.payments[0].method).toBe("CASH");

  // Once is all: a second attempt has nothing to delete.
  expect((await del(request, order.id, { reason, password: DEMO_PASSWORD })).status()).toBe(409);
});

test("an open table order frees the table", async ({ request }) => {
  await setFeature(true);
  const table = await getAvailableTable(request);
  const item = await getMenuItemId(request, SEED_MENU_ITEM.name);
  const order = await createOrder(request, { type: "DINE_IN", tableId: table.id, lines: [{ menuItemId: item, quantity: 1 }] });
  expect((await request.post(`/api/orders/${order.id}/send-to-kitchen`)).ok()).toBeTruthy();

  const res = await del(request, order.id, { reason: "wrong table", password: DEMO_PASSWORD });
  expect(res.ok(), await res.text()).toBeTruthy();
  const status = await withDb(async (c) =>
    (await c.query('SELECT status FROM "RestaurantTable" WHERE id = $1', [table.id])).rows[0].status
  );
  expect(status).toBe("AVAILABLE");
  // A deleted order can't be paid or added to afterwards. Offered in full, so what refuses it is the
  // order being closed — an underpayment would be refused first, for the wrong reason.
  const total = await withDb(async (c) =>
    (await c.query('SELECT "totalPaisa" FROM "Order" WHERE id = $1', [order.id])).rows[0].totalPaisa as number
  );
  const pay = await request.post(`/api/orders/${order.id}/pay`, {
    data: { tenders: [{ method: "CASH", amountPaisa: total }] },
  });
  expect(pay.status()).toBe(409);
  expect(await pay.text()).toMatch(/deleted/);
  const add = await request.post(`/api/orders/${order.id}/lines`, { data: { lines: [{ menuItemId: item, quantity: 1 }] } });
  expect(add.status()).toBe(409);
});

test("the log can't be edited or erased, even by the app's own database role", async () => {
  // DATABASE_URL is the role the running app uses. The migration gave it INSERT and SELECT only.
  const app = new Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  try {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await expect(app.query('DELETE FROM "OrderDeletion"')).rejects.toThrow(/permission denied/);
    await app.query("ROLLBACK");
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await expect(app.query(`UPDATE "OrderDeletion" SET reason = 'changed'`)).rejects.toThrow(/permission denied/);
  } finally {
    await app.query("ROLLBACK").catch(() => {});
    await app.end();
  }
});

test("the platform admin can read the restaurant's log", async ({ baseURL }) => {
  const { ctx: admin, restore } = await platformAdmin(baseURL!);
  try {
    const res = await admin.get(`/api/platform/tenants/${tenantId}/order-deletions`);
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(((await res.json()).deletions as unknown[]).length).toBeGreaterThan(0);
  } finally {
    await restore();
  }
});

test("the owner deletes from the Order Queue through the dialog", async ({ page, request }) => {
  await setFeature(true);
  const order = await paidOrder(request);
  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Order Queue" }).click();
  const card = page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` }).first();
  await card.getByRole("button", { name: "Delete order" }).click();

  const dialog = page.getByRole("dialog", { name: `Delete order #${order.orderNumber}?` });
  await dialog.getByLabel("Why is it being deleted?").fill("test order from the e2e suite");
  await dialog.getByLabel("Your password").fill(DEMO_PASSWORD);
  await dialog.getByRole("button", { name: "Delete order" }).click();
  await expect(page.getByText(`Order #${order.orderNumber} deleted.`)).toBeVisible();
  await expect(page.locator("div.rounded-xl", { hasText: `#${order.orderNumber}` })).toHaveCount(0);
});
