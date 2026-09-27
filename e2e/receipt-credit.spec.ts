import "dotenv/config";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { authFile, uniqueSuffix, TENANT_SLUG } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * "ToffeeOS by Krimsols · @krimsols" at the foot of every restaurant's receipts and bills.
 *
 * On for every restaurant. Only the platform admin can switch it off for one — a restaurant has no
 * switch of its own. The Instagram mark is drawn in plain lines (there is no Instagram emoji, and a
 * colour one prints as a grey smudge on a thermal printer).
 */

type Order = { id: string; orderNumber: number };

async function takeaway(request: APIRequestContext): Promise<Order> {
  const menuItemId = await getMenuItemId(request, "Fish Pakora");
  const res = await request.post("/api/orders", {
    data: { type: "TAKEAWAY", idempotencyKey: `credit-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const order = (await res.json()).order as Order;
  expect((await request.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} })).ok()).toBeTruthy();
  return order;
}

async function pay(request: APIRequestContext, order: Order) {
  const preview = await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method: "CASH", amountPaisa: 0 }] } });
  const total = (await preview.json()).totals.totalPaisa as number;
  expect((await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: total }] } })).ok()).toBeTruthy();
}

async function openQueue(page: Page) {
  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Order Queue" }).click();
}

const row = (page: Page, order: Order) => page.locator("div.rounded-xl", { hasText: `#${order.orderNumber} ·` }).first();

async function tenantId(): Promise<string> {
  return withDb(async (c) => (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id as string);
}

test.describe("The ToffeeOS credit on receipts", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("a bill and a receipt carry it at the foot, and it prints", async ({ page, request }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
    const unpaid = await takeaway(request);
    const paid = await takeaway(request);
    await pay(request, paid);

    await openQueue(page);
    await row(page, unpaid).getByRole("button", { name: "Bill", exact: true }).click();
    const bill = page.getByRole("dialog", { name: new RegExp(`Bill — Order #${unpaid.orderNumber}`) });
    const credit = bill.getByTestId("receipt-credit");
    await expect(credit).toBeVisible({ timeout: 20_000 });
    await expect(credit).toHaveText(/ToffeeOS by Krimsols ·\s*@krimsols/);
    await expect(credit.getByRole("img", { name: "Instagram" }), "the Instagram mark, drawn not an emoji").toBeVisible();

    // It is the last thing on the paper, and it goes to the printer with the rest.
    await bill.getByRole("button", { name: "Print bill" }).click();
    const printed = await page.evaluate(() => document.getElementById("print-root")?.innerText ?? "");
    expect(printed).toContain("ToffeeOS by Krimsols");
    expect(printed.trim().endsWith("@krimsols"), "at the very foot").toBe(true);
    await bill.getByRole("button", { name: "Close" }).last().click();

    await row(page, paid).getByRole("button", { name: "Reprint receipt" }).click();
    const receipt = page.getByRole("dialog", { name: new RegExp(`Receipt — Order #${paid.orderNumber}`) });
    await expect(receipt.getByTestId("receipt-credit")).toHaveText(/ToffeeOS by Krimsols ·\s*@krimsols/);
  });

  test("only the platform admin can switch it off for a restaurant", async ({ page, request, baseURL }) => {
    const id = await tenantId();
    // The restaurant itself has no way to: the platform's routes don't accept its session.
    expect([401, 403]).toContain((await request.patch(`/api/platform/tenants/${id}/receipt-credit`, { data: { on: false } })).status());

    const { ctx: admin, restore } = await platformAdmin(baseURL!);
    try {
      const off = await admin.patch(`/api/platform/tenants/${id}/receipt-credit`, { data: { on: false } });
      expect(off.ok(), await off.text()).toBeTruthy();

      const order = await takeaway(request);
      await openQueue(page);
      await row(page, order).getByRole("button", { name: "Bill", exact: true }).click();
      const bill = page.getByRole("dialog", { name: new RegExp(`Bill — Order #${order.orderNumber}`) });
      await expect(bill.getByText("BILL", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(bill.getByTestId("receipt-credit"), "switched off for this restaurant").toHaveCount(0);
      await request.post(`/api/orders/${order.id}/void`, { data: { reason: "test tidy-up" } });

      // Recorded, like every other change the platform makes to a restaurant.
      const logged = await withDb((c) =>
        c.query(`SELECT metadata FROM "AuditLog" WHERE "tenantId" = $1 AND action = 'platform.receiptCredit.change' ORDER BY "createdAt" DESC LIMIT 1`, [id])
      );
      expect(logged.rows[0].metadata.to).toBe(false);
    } finally {
      // Back on, whatever happened: it is on for every restaurant.
      await admin.patch(`/api/platform/tenants/${id}/receipt-credit`, { data: { on: true } });
      await restore();
    }
  });
});
