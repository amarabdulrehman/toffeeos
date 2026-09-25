import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix, USERS, TENANT_SLUG, DEMO_PASSWORD } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * The back-office features that gave the last permissions on the roles screen something to gate:
 * purchase orders, transfer approval, undoing an adjustment, branch prices, the role editor,
 * loyalty points, the online menu switch, and the service-charge and report-export permissions.
 *
 * Several need someone who can do one thing and not another — ask for a transfer but not approve
 * it, say. Rather than seed a new account, these borrow the waiter's: give it a custom role, sign
 * in afresh, and put everything back in `finally`, including a fresh saved sign-in for the specs
 * that run after.
 */

/** The same CSRF-then-credentials sequence as e2e/global-setup.ts. Optionally saves the session. */
async function signIn(baseURL: string | undefined, user: keyof typeof USERS, saveTo?: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  const res = await ctx.post("/api/auth/callback/credentials", {
    form: { tenantSlug: TENANT_SLUG, email: USERS[user].email, password: DEMO_PASSWORD, csrfToken, json: "true" },
  });
  expect(res.ok() || res.status() === 302, `sign in as ${user}`).toBeTruthy();
  if (saveTo) await ctx.storageState({ path: saveTo });
  return ctx;
}

async function ok<T = Record<string, unknown>>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as T;
}

async function stockLevel(request: APIRequestContext, itemId: string, locationId: string): Promise<number> {
  const { rows } = await ok<{ rows: { itemId: string; locationId: string; quantity: number }[] }>(await request.get("/api/inventory/report"));
  return rows.find((r) => r.itemId === itemId && r.locationId === locationId)?.quantity ?? 0;
}

async function newStockItem(request: APIRequestContext) {
  const { item } = await ok<{ item: { id: string; name: string } }>(
    await request.post("/api/inventory/items", { data: { name: `E2E Flour ${uniqueSuffix()}`, unitOfMeasure: "kg", lowStockThresholdQty: 0 } })
  );
  return item;
}

async function locations(request: APIRequestContext) {
  const { locations: list } = await ok<{ locations: { id: string; name: string }[] }>(await request.get("/api/inventory/locations"));
  if (list.length < 2) {
    await ok(await request.post("/api/inventory/locations", { data: { name: `E2E Store ${uniqueSuffix()}` } }));
    return (await ok<{ locations: { id: string; name: string }[] }>(await request.get("/api/inventory/locations"))).locations;
  }
  return list;
}

/** Gives the waiter account a custom role for the length of `body`, then puts everything back. */
async function asCustomRole(
  request: APIRequestContext,
  baseURL: string | undefined,
  permissions: string[],
  body: (waiter: APIRequestContext, roleId: string) => Promise<void>
) {
  const staff = await ok<{ members: { id: string; email: string | null; roleId: string }[] }>(await request.get("/api/staff"));
  const membership = staff.members.find((m) => m.email === USERS.waiter.email)!;
  expect(membership, "the demo waiter should be on the staff list").toBeTruthy();
  const originalRoleId = membership.roleId;
  const { role } = await ok<{ role: { id: string } }>(
    await request.post("/api/roles", { data: { name: `E2E role ${uniqueSuffix()}`, permissions } })
  );
  try {
    await ok(await request.patch(`/api/staff/members/${membership.id}`, { data: { roleId: role.id } }));
    const waiter = await signIn(baseURL, "waiter");
    try {
      await body(waiter, role.id);
    } finally {
      await waiter.dispose();
    }
  } finally {
    await request.patch(`/api/staff/members/${membership.id}`, { data: { roleId: originalRoleId } });
    await request.delete(`/api/roles/${role.id}`);
    // The role change ended the waiter's sessions; later specs read the saved one.
    const fresh = await signIn(baseURL, "waiter", authFile("waiter"));
    await fresh.dispose();
  }
}

test.describe("Back office", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 180_000 });

  test("a purchase order is drafted, approved and received — a short delivery counted as it arrived", async ({ request, baseURL }) => {
    const item = await newStockItem(request);
    const [location] = await locations(request);
    const { supplier } = await ok<{ supplier: { id: string } }>(
      await request.post("/api/inventory/suppliers", { data: { name: `E2E Mills ${uniqueSuffix()}`, phone: "0300 0000000" } })
    );

    const { purchaseOrder } = await ok<{ purchaseOrder: { id: string } }>(
      await request.post("/api/inventory/purchase-orders", {
        data: { supplierId: supplier.id, locationId: location.id, lines: [{ itemId: item.id, quantity: 10, unitCostPaisa: 5_000 }] },
      })
    );
    const before = await stockLevel(request, item.id, location.id);

    const early = await request.post(`/api/inventory/purchase-orders/${purchaseOrder.id}/receive`, { data: {} });
    expect(early.status(), "a draft can't be received before it is approved").toBe(409);

    await ok(await request.post(`/api/inventory/purchase-orders/${purchaseOrder.id}/approve`));
    const list = await ok<{ purchaseOrders: { id: string; lines: { id: string }[] }[] }>(await request.get("/api/inventory/purchase-orders"));
    const lineId = list.purchaseOrders.find((p) => p.id === purchaseOrder.id)!.lines[0].id;

    await ok(await request.post(`/api/inventory/purchase-orders/${purchaseOrder.id}/receive`, { data: { received: [{ lineId, quantity: 8 }] } }));
    expect((await stockLevel(request, item.id, location.id)) - before, "what arrived is what's counted").toBe(8);

    const twice = await request.post(`/api/inventory/purchase-orders/${purchaseOrder.id}/receive`, { data: {} });
    expect(twice.status(), "a delivery is counted in once").toBe(409);

    const cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    const denied = await cashier.post("/api/inventory/purchase-orders", {
      data: { supplierId: supplier.id, locationId: location.id, lines: [{ itemId: item.id, quantity: 1, unitCostPaisa: 1 }] },
    });
    expect(denied.status(), "a cashier can't order stock").toBe(403);
    await cashier.dispose();
  });

  test("undoing an adjustment puts the stock back, and only once", async ({ request }) => {
    const item = await newStockItem(request);
    const [location] = await locations(request);
    await ok(await request.post("/api/inventory/grn", { data: { locationId: location.id, itemId: item.id, quantity: 20 } }));
    await ok(await request.post("/api/inventory/adjustment", { data: { locationId: location.id, itemId: item.id, quantityDelta: -15, reason: "typed 15, meant 1.5" } }));
    expect(await stockLevel(request, item.id, location.id)).toBe(5);

    const { adjustments } = await ok<{ adjustments: { id: string; itemName: string }[] }>(await request.get("/api/inventory/adjustments"));
    const mine = adjustments.find((a) => a.itemName === item.name)!;
    await ok(await request.post(`/api/inventory/adjustment/${mine.id}/reverse`, { data: { reason: "wrong number" } }));
    expect(await stockLevel(request, item.id, location.id), "back to what it was").toBe(20);

    const again = await request.post(`/api/inventory/adjustment/${mine.id}/reverse`, { data: { reason: "double tap" } });
    expect(again.status(), "an adjustment can only be undone once").toBe(409);
    expect(await stockLevel(request, item.id, location.id)).toBe(20);
  });

  test("someone who can't approve transfers asks, and nothing moves until it's approved", async ({ request, baseURL }) => {
    const item = await newStockItem(request);
    const [from, to] = await locations(request);
    await ok(await request.post("/api/inventory/grn", { data: { locationId: from.id, itemId: item.id, quantity: 10 } }));

    await asCustomRole(request, baseURL, ["inventory.view", "inventory.transfer.create"], async (clerk) => {
      const asked = await ok<{ requested: boolean }>(
        await clerk.post("/api/inventory/transfer", { data: { fromLocationId: from.id, toLocationId: to.id, itemId: item.id, quantity: 4 } })
      );
      expect(asked.requested, "it became a request").toBe(true);
      expect(await stockLevel(request, item.id, from.id), "nothing moved yet").toBe(10);

      const cantApprove = await clerk.get("/api/inventory/transfer-requests");
      const pending = (await cantApprove.json()).requests.find((r: { itemName: string; status: string }) => r.itemName === item.name && r.status === "PENDING");
      expect((await clerk.post(`/api/inventory/transfer-requests/${pending.id}`, { data: { approve: true } })).status(), "they can't approve their own").toBe(403);

      await ok(await request.post(`/api/inventory/transfer-requests/${pending.id}`, { data: { approve: true } }));
      expect(await stockLevel(request, item.id, from.id), "moved once approved").toBe(6);
      expect(await stockLevel(request, item.id, to.id)).toBe(4);
    });
  });

  test("a role change applies at once, the Owner role can't be edited, and roles in use can't be removed", async ({ request, baseURL }) => {
    const { roles } = await ok<{ roles: { id: string; key: string; memberCount: number }[] }>(await request.get("/api/roles"));
    const owner = roles.find((r) => r.key === "owner")!;
    expect((await request.patch(`/api/roles/${owner.id}`, { data: { permissions: [] } })).status(), "Owner is locked").toBe(400);
    const cashierRole = roles.find((r) => r.key === "cashier")!;
    expect((await request.delete(`/api/roles/${cashierRole.id}`)).status(), "a role people hold stays").toBe(409);

    const cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    expect((await cashier.get("/api/roles")).status(), "only the owner edits roles").toBe(403);
    await cashier.dispose();

    await asCustomRole(request, baseURL, ["pos.access", "orders.view"], async (waiter, roleId) => {
      expect((await waiter.get("/api/orders")).ok(), "their new role lets them see orders").toBe(true);
      // Take it away, applying it now: their next request is refused.
      await ok(await request.patch(`/api/roles/${roleId}`, { data: { permissions: ["pos.access"], signOutNow: true } }));
      expect([401, 403], "signed out, so the change is in force").toContain((await waiter.get("/api/orders")).status());
    });
  });

  test("a dish's price at one branch is what that branch's till charges", async ({ request }) => {
    const menuItemId = await getMenuItemId(request, "Dahi Bhalla");
    const { branchId } = (await (await request.get("/api/auth/session")).json()).user as { branchId: string };
    try {
      await ok(await request.put(`/api/menu-items/${menuItemId}/branch-prices`, { data: { branchId, pricePaisa: 31_500 } }));
      const created = await ok<{ order: { id: string } }>(
        await request.post("/api/orders", { data: { type: "TAKEAWAY", idempotencyKey: `branch-price-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] } })
      );
      const { order } = await ok<{ order: { lines: { unitPricePaisa: number }[] } }>(await request.get(`/api/orders/${created.order.id}`));
      expect(order.lines[0].unitPricePaisa, "charged the branch's own price").toBe(31_500);
    } finally {
      await request.put(`/api/menu-items/${menuItemId}/branch-prices`, { data: { branchId, pricePaisa: null } });
    }
  });

  test("loyalty: points earned on a paid bill, spent on another, given back on a void, taken back on a refund", async ({ request, baseURL }) => {
    await ok(await request.put("/api/loyalty", { data: { isEnabled: true, pointsPerHundredRupees: 10, paisaPerPoint: 100 } }));
    try {
      const phone = `0301${String(Date.now()).slice(-7)}`;
      const { customer } = await ok<{ customer: { id: string } }>(
        await request.post("/api/customers/find-or-create", { data: { phone, name: `Loyal ${uniqueSuffix()}` } })
      );
      const balance = async () =>
        (await ok<{ customer: { loyaltyPoints: number } }>(await request.get(`/api/customers/${customer.id}`))).customer.loyaltyPoints;
      const menuItemId = await getMenuItemId(request, "Fish Pakora");
      const order = async () =>
        (await ok<{ order: { id: string; totalPaisa: number } }>(
          await request.post("/api/orders", { data: { type: "TAKEAWAY", customerId: customer.id, idempotencyKey: `loyal-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 2 }] } })
        )).order;
      const payCash = async (id: string) => {
        const due = (await ok<{ totals: { totalPaisa: number } }>(await request.post(`/api/orders/${id}/pay-preview`, { data: { tenders: [{ method: "CASH", amountPaisa: 0 }] } }))).totals.totalPaisa;
        return (await ok<{ order: { totalPaisa: number } }>(await request.post(`/api/orders/${id}/pay`, { data: { tenders: [{ method: "CASH", amountPaisa: due }] } }))).order;
      };

      const first = await order();
      const paid = await payCash(first.id);
      const earned = Math.floor((paid.totalPaisa * 10) / 10_000);
      expect(earned, "a bill this size should earn points, or this proves nothing").toBeGreaterThan(0);
      expect(await balance(), "10 points per Rs 100").toBe(earned);

      const second = await order();
      await ok(await request.post(`/api/orders/${second.id}/redeem-points`, { data: { points: earned } }));
      expect(await balance(), "spent").toBe(0);
      const after = (await ok<{ order: { discounts: { value: number }[] } }>(await request.get(`/api/orders/${second.id}`))).order;
      expect(after.discounts[0].value, "worth Rs 1 each").toBe(earned * 100);

      await ok(await request.post(`/api/orders/${second.id}/void`, { data: { reason: "loyalty spec" } }));
      expect(await balance(), "a void gives them back").toBe(earned);

      await ok(await request.post(`/api/orders/${first.id}/refund`, { data: { amountPaisa: paid.totalPaisa, method: "CASH", reason: "loyalty spec" } }));
      expect(await balance(), "a full refund takes back what that bill earned").toBe(0);

      const cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
      expect((await cashier.post(`/api/customers/${customer.id}/points`, { data: { points: 50, reason: "friend of the owner" } })).status(), "a cashier can't hand out points").toBe(403);
      await cashier.dispose();
      await ok(await request.post(`/api/customers/${customer.id}/points`, { data: { points: 50, reason: "goodwill" } }));
      expect(await balance()).toBe(50);
    } finally {
      await request.put("/api/loyalty", { data: { isEnabled: false, pointsPerHundredRupees: 1, paisaPerPoint: 100 } });
    }
  });

  test("a dish kept off the online menu isn't shown there and can't be ordered there", async ({ request, playwright }) => {
    const menuItemId = await getMenuItemId(request, "Dahi Bhalla");
    const { branchId } = (await (await request.get("/api/auth/session")).json()).user as { branchId: string };
    const publicApi = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      await ok(await request.patch(`/api/menu-items/${menuItemId}/online`, { data: { isAvailableOnline: false } }));
      const menu = await ok<{ categories: { items: { id: string }[] }[] }>(await publicApi.get(`/api/online-order/${TENANT_SLUG}/menu?branchId=${branchId}`));
      expect(menu.categories.flatMap((c) => c.items).some((i) => i.id === menuItemId), "hidden from the online menu").toBe(false);

      const res = await publicApi.post(`/api/online-order/${TENANT_SLUG}/checkout`, {
        data: {
          branchId,
          customerName: "Online Probe",
          customerPhone: "03001112223",
          fulfillment: "PICKUP",
          lines: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `online-hidden-${uniqueSuffix()}`,
        },
      });
      expect(res.status(), "refused at checkout too").toBe(400);

      // The till still sells it.
      const till = await request.post("/api/orders", { data: { type: "TAKEAWAY", idempotencyKey: `till-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] } });
      expect(till.ok(), await till.text()).toBeTruthy();
    } finally {
      await request.patch(`/api/menu-items/${menuItemId}/online`, { data: { isAvailableOnline: true } });
      await publicApi.dispose();
    }
  });

  test("the service charge and report downloads each need their own permission", async ({ request, baseURL, browser }) => {
    const current = (await ok<{ settings: { serviceChargeTaxable: boolean; kdsEnabled: boolean } }>(await request.get("/api/branch-settings"))).settings;
    await asCustomRole(request, baseURL, ["settings.general.manage", "reports.sales.view"], async (manager) => {
      const other = await manager.patch("/api/branch-settings", { data: { kdsEnabled: current.kdsEnabled } });
      expect(other.ok(), "general settings still work").toBe(true);
      const svc = await manager.patch("/api/branch-settings", { data: { serviceChargeTaxable: current.serviceChargeTaxable } });
      expect(svc.status(), "but not the service charge").toBe(403);

      // Reports: the figures, but no download button.
      const state = await manager.storageState();
      const context = await browser.newContext({ baseURL, storageState: state });
      const page = await context.newPage();
      await page.goto("/app/reports");
      await expect(page.getByText(/Total sales|Net sales|Orders/).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
      await context.close();
    });

    // The owner does get it.
    const context = await browser.newContext({ baseURL, storageState: authFile("owner") });
    const page = await context.newPage();
    await page.goto("/app/reports");
    await expect(page.getByRole("button", { name: "Export CSV" }).first()).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  test("on screen: an adjustment is undone from the Inventory screen, with a reason", async ({ page, request }) => {
    const item = await newStockItem(request);
    const [location] = await locations(request);
    await ok(await request.post("/api/inventory/grn", { data: { locationId: location.id, itemId: item.id, quantity: 12 } }));
    await ok(await request.post("/api/inventory/adjustment", { data: { locationId: location.id, itemId: item.id, quantityDelta: -10, reason: "slip of the finger" } }));

    await page.goto("/app/inventory");
    await page.getByRole("tab", { name: "Adjust" }).click();
    const row = page.locator("div", { hasText: item.name }).filter({ has: page.getByRole("button", { name: "Undo" }) }).last();
    await row.getByRole("button", { name: "Undo" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Undo it" }), "no reason, no undo").toBeDisabled();
    await dialog.getByLabel("Reason").fill("typed 10, meant 1");
    await dialog.getByRole("button", { name: "Undo it" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(await stockLevel(request, item.id, location.id), "the stock is back").toBe(12);

    // And the new tabs are there.
    await expect(page.getByRole("tab", { name: "Purchase orders" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Suppliers" })).toBeVisible();
  });

  test("the owner can see their plan and payments", async ({ page }) => {
    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();
    await expect(page.getByText("Monthly cost")).toBeVisible();
  });
});
