import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getAvailableTable, getMenuItemId } from "./fixtures/api";

/**
 * Waiters at the till, and waiter orders that wait for the counter.
 *
 * Two things the owner asked for:
 *
 * - A waiter tapping a table that already has an order was shown a big green Take Payment — which
 *   they can't do — and no way to send anything to the kitchen but a plain "Add items". Dishes they
 *   tapped on the menu meanwhile went into a hidden cart and were thrown away.
 * - Some restaurants want a waiter's order checked at the counter before the kitchen starts on it.
 *   A switch per branch (off by default): when on, a waiter's order — or another round — pops up on
 *   the cashier's till, and goes to the kitchen only when the cashier sends it. Rejected, the waiter
 *   is told why. The server decides; the till only labels and alerts.
 */

const ALERT_WAIT = 30_000;

async function till(browser: Browser, baseURL: string | undefined, who: "cashier" | "waiter"): Promise<Page> {
  const context = await browser.newContext({ baseURL, storageState: authFile(who) });
  const page = await context.newPage();
  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced").first()).toBeVisible({ timeout: 20_000 });
  // The till's first look at the order activity sets its starting point; what follows is "new".
  await page.waitForResponse((r) => r.url().includes("/api/orders/activity"), { timeout: 20_000 }).catch(() => {});
  return page;
}

async function api(who: "owner" | "cashier" | "waiter" | "kitchen", baseURL: string | undefined) {
  return playwrightRequest.newContext({ baseURL, storageState: authFile(who) });
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** A dine-in order on a free table, placed and sent the way the till does it. */
async function placeDineIn(ctx: APIRequestContext, owner: APIRequestContext, dish = "Fish Pakora") {
  const table = await getAvailableTable(owner);
  const menuItemId = await getMenuItemId(ctx, dish);
  const { order } = await ok<{ order: { id: string; orderNumber: number } }>(
    await ctx.post("/api/orders", {
      data: {
        type: "DINE_IN",
        tableId: table.id,
        idempotencyKey: `approval-${uniqueSuffix()}`,
        lines: [{ menuItemId, quantity: 1 }],
      },
    }),
  );
  const sent = await ok<{ awaitingApproval: boolean }>(
    await ctx.post(`/api/orders/${order.id}/send-to-kitchen`, { data: {} }),
  );
  return { order, table, awaitingApproval: sent.awaitingApproval };
}

async function orderNow(ctx: APIRequestContext, orderId: string) {
  return (
    await ok<{ order: { status: string; totalPaisa: number; lines: { isVoided: boolean }[] } }>(
      await ctx.get(`/api/orders/${orderId}`),
    )
  ).order;
}

async function inKitchen(ctx: APIRequestContext, orderId: string): Promise<boolean> {
  const { orders } = await ok<{ orders: { id: string }[] }>(await ctx.get("/api/kds/orders"));
  return orders.some((o) => o.id === orderId);
}

async function pendingFor(cashier: APIRequestContext, orderId: string) {
  const { approvals } = await ok<{
    approvals: { id: string; kind: string; orderId: string; items: { name: string }[] }[];
  }>(await cashier.get("/api/orders/approvals"));
  return approvals.filter((a) => a.orderId === orderId);
}

async function setApprovals(owner: APIRequestContext, on: boolean) {
  await ok(await owner.patch("/api/branch-settings", { data: { waiterOrdersNeedApproval: on } }));
}

test.describe("A waiter at a table already eating", () => {
  test.describe.configure({ timeout: 180_000 });

  test("sees Add items and no Take Payment, and a dish tapped on the menu starts the next round", async ({
    browser,
    baseURL,
  }) => {
    const owner = await api("owner", baseURL);
    const waiter = await api("waiter", baseURL);
    const page = await till(browser, baseURL, "waiter");
    try {
      await setApprovals(owner, false);
      const { order, table } = await placeDineIn(waiter, owner);

      await page.getByText("Select a table").click();
      const tables = page.getByRole("dialog", { name: "Tables" });
      await tables.locator("button.size-20", { hasText: table.label }).first().click();
      await expect(page.getByText(`Table ${table.label} · Order #${order.orderNumber}`, { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      await expect(page.getByRole("button", { name: "Add items" }), "the waiter's way forward").toBeVisible();
      await expect(page.getByRole("button", { name: "Take Payment" }), "not something a waiter can do").toHaveCount(0);

      // Tapping a dish is the next round, not a hidden cart that "Add items" then empties.
      await page.getByText("Dahi Bhalla").first().click();
      await expect(page.getByText(`Adding to Order #${order.orderNumber}`)).toBeVisible();
      await expect(page.getByText("Dahi Bhalla").last()).toBeVisible();
      await page.getByRole("button", { name: "Send to Kitchen" }).click();
      await expect(page.getByText(`Added to order #${order.orderNumber}.`)).toBeVisible({ timeout: 20_000 });
      expect((await orderNow(waiter, order.id)).lines.filter((l) => !l.isVoided)).toHaveLength(2);
    } finally {
      await owner.dispose();
      await waiter.dispose();
      await page.context().close();
    }
  });
});

test.describe("Waiter orders that wait for the counter", () => {
  test.describe.configure({ timeout: 180_000 });
  let owner: APIRequestContext;

  test.beforeAll(async ({ baseURL }) => {
    owner = await api("owner", baseURL);
    await setApprovals(owner, true);
  });
  test.afterAll(async () => {
    // Off again, whatever happened: every other spec expects a waiter's order in the kitchen at once.
    await setApprovals(owner, false);
    await owner.dispose();
  });

  test("a waiter's order waits, pops up at the counter, and goes to the kitchen when sent", async ({
    browser,
    baseURL,
  }) => {
    const cashierTill = await till(browser, baseURL, "cashier");
    const waiterTill = await till(browser, baseURL, "waiter");
    const waiter = await api("waiter", baseURL);
    const kitchen = await api("kitchen", baseURL);
    try {
      const { order, awaitingApproval } = await placeDineIn(waiter, owner);
      expect(awaitingApproval, "held for the counter").toBe(true);
      expect((await orderNow(owner, order.id)).status, "not sent").toBe("OPEN");
      expect(await inKitchen(kitchen, order.id), "and not on the kitchen screen").toBe(false);

      // The counter is told, with the chime's pop-up and a count on the Order Queue button.
      await expect(cashierTill.getByText(`Order #${order.orderNumber} needs your approval`)).toBeVisible({
        timeout: ALERT_WAIT,
      });
      await expect(cashierTill.getByTestId("approval-count")).toBeVisible();
      // Not a second, plain "new order" pop-up for the same order.
      await expect(cashierTill.getByText(`New order #${order.orderNumber}`)).toHaveCount(0);

      await cashierTill.getByRole("button", { name: "Review" }).first().click();
      const request = cashierTill
        .getByTestId("approval-request")
        .filter({ hasText: `New order #${order.orderNumber}` });
      await expect(request).toBeVisible({ timeout: 20_000 });
      await expect(request).toContainText("Fish Pakora");
      // Not payable while it waits: the queue says so instead of offering Payment.
      const row = cashierTill.locator("div.rounded-xl", { hasText: `#${order.orderNumber} ·` }).first();
      await expect(row.getByText("Waiting for approval")).toBeVisible();
      await request.getByRole("button", { name: "Send to kitchen" }).click();
      // Generous: the first approval against a dev server compiles the route on the spot.
      await expect(cashierTill.getByText(`Order #${order.orderNumber} sent to kitchen.`)).toBeVisible({
        timeout: 60_000,
      });
      await expect(row.getByRole("button", { name: "Payment" }), "payable once it has gone to the kitchen").toBeVisible(
        { timeout: 20_000 },
      );

      expect((await orderNow(owner, order.id)).status).toBe("SENT_TO_KITCHEN");
      expect(await inKitchen(kitchen, order.id), "now the kitchen has it").toBe(true);
      await expect(waiterTill.getByText(`Order #${order.orderNumber} approved`), "and the waiter hears").toBeVisible({
        timeout: ALERT_WAIT,
      });
    } finally {
      await waiter.dispose();
      await kitchen.dispose();
      await cashierTill.context().close();
      await waiterTill.context().close();
    }
  });

  test("a rejected order tells the waiter why, is voided, and frees the table", async ({ browser, baseURL }) => {
    const waiterTill = await till(browser, baseURL, "waiter");
    const waiter = await api("waiter", baseURL);
    const cashier = await api("cashier", baseURL);
    try {
      const { order, table } = await placeDineIn(waiter, owner);
      const [request] = await pendingFor(cashier, order.id);
      await ok(
        await cashier.post(`/api/orders/approvals/${request.id}/reject`, {
          data: { reason: "Karahi is finished for today" },
        }),
      );

      expect((await orderNow(owner, order.id)).status, "never a sale").toBe("VOIDED");
      const { floors } = await ok<{ floors: { tables: { id: string; status: string }[] }[] }>(
        await owner.get("/api/tables"),
      );
      expect(floors.flatMap((f) => f.tables).find((t) => t.id === table.id)?.status, "the table is free again").toBe(
        "AVAILABLE",
      );
      await expect(waiterTill.getByText(`Order #${order.orderNumber} was not approved`)).toBeVisible({
        timeout: ALERT_WAIT,
      });
      await expect(waiterTill.getByText(/Karahi is finished for today/).first()).toBeVisible();
    } finally {
      await waiter.dispose();
      await cashier.dispose();
      await waiterTill.context().close();
    }
  });

  test("another round waits too: nothing is added until it is approved, and a rejected one never is", async ({
    baseURL,
  }) => {
    const waiter = await api("waiter", baseURL);
    const cashier = await api("cashier", baseURL);
    try {
      // The cashier's own order goes straight to the kitchen: the counter never waits for itself.
      const placed = await placeDineIn(cashier, owner);
      expect(placed.awaitingApproval).toBe(false);
      const order = placed.order;
      const before = await orderNow(owner, order.id);
      expect(before.status).toBe("SENT_TO_KITCHEN");

      const samosa = await getMenuItemId(waiter, "Vegetable Samosa (4pc)");
      const asked = await ok<{ awaitingApproval: boolean }>(
        await waiter.post(`/api/orders/${order.id}/lines`, { data: { lines: [{ menuItemId: samosa, quantity: 2 }] } }),
      );
      expect(asked.awaitingApproval).toBe(true);
      const held = await orderNow(owner, order.id);
      expect(held.lines, "not on the order yet").toHaveLength(before.lines.length);
      expect(held.totalPaisa, "nor on the bill").toBe(before.totalPaisa);

      const [round] = await pendingFor(cashier, order.id);
      expect(round.kind).toBe("MORE_ITEMS");
      expect(round.items.map((i) => i.name)).toEqual(["Vegetable Samosa (4pc)"]);
      await ok(await cashier.post(`/api/orders/approvals/${round.id}/approve`));
      const added = await orderNow(owner, order.id);
      expect(added.lines, "on the order once approved").toHaveLength(before.lines.length + 1);
      expect(added.totalPaisa).toBeGreaterThan(before.totalPaisa);

      // A second round, turned away: the order is as it was.
      await ok(
        await waiter.post(`/api/orders/${order.id}/lines`, { data: { lines: [{ menuItemId: samosa, quantity: 1 }] } }),
      );
      const [second] = await pendingFor(cashier, order.id);
      await ok(
        await cashier.post(`/api/orders/approvals/${second.id}/reject`, {
          data: { reason: "Table asked to cancel it" },
        }),
      );
      const after = await orderNow(owner, order.id);
      expect(after.lines).toHaveLength(added.lines.length);
      expect(after.totalPaisa).toBe(added.totalPaisa);
    } finally {
      await waiter.dispose();
      await cashier.dispose();
    }
  });

  test("a round waiting on a table that gets merged follows the bill, and still needs approving", async ({ baseURL }) => {
    const waiter = await api("waiter", baseURL);
    const cashier = await api("cashier", baseURL);
    try {
      const target = (await placeDineIn(cashier, owner)).order;
      const source = (await placeDineIn(cashier, owner, "Dahi Bhalla")).order;
      const samosa = await getMenuItemId(waiter, "Vegetable Samosa (4pc)");
      await ok(await waiter.post(`/api/orders/${source.id}/lines`, { data: { lines: [{ menuItemId: samosa, quantity: 1 }] } }));

      // Tables pushed together: the source's bill joins the target's.
      await ok(await cashier.post(`/api/orders/${target.id}/merge`, { data: { sourceOrderId: source.id } }));
      expect(await pendingFor(cashier, source.id), "nothing left waiting on the closed bill").toHaveLength(0);
      const [round] = await pendingFor(cashier, target.id);
      expect(round?.kind, "the round moved with the bill").toBe("MORE_ITEMS");

      const before = await orderNow(owner, target.id);
      await ok(await cashier.post(`/api/orders/approvals/${round.id}/approve`));
      expect((await orderNow(owner, target.id)).lines, "and lands on the merged bill").toHaveLength(before.lines.length + 1);
    } finally {
      await waiter.dispose();
      await cashier.dispose();
    }
  });

  test("the waiter's till says Send for approval, and says where the order went", async ({ browser, baseURL }) => {
    const page = await till(browser, baseURL, "waiter");
    const cashier = await api("cashier", baseURL);
    try {
      const table = await getAvailableTable(owner);
      await page.getByText("Select a table").click();
      const tables = page.getByRole("dialog", { name: "Tables" });
      await tables.locator("button.size-20", { hasText: table.label }).first().click();
      await page.getByText("Fish Pakora").first().click();
      await expect(page.getByRole("button", { name: "Send to Kitchen" })).toHaveCount(0);
      await page.getByRole("button", { name: "Send for approval" }).click();
      const toast = page.getByText(/Order #\d+ sent to the counter for approval\./);
      await expect(toast).toBeVisible({ timeout: 20_000 });
      const orderNumber = Number((await toast.innerText()).match(/#(\d+)/)![1]);

      // Tidy up: the counter turns it away, so the table is free for the next spec.
      const { approvals } = await ok<{ approvals: { id: string; orderNumber: number }[] }>(
        await cashier.get("/api/orders/approvals"),
      );
      const mine = approvals.find((a) => a.orderNumber === orderNumber);
      expect(mine, "and it is waiting at the counter").toBeTruthy();
      await ok(await cashier.post(`/api/orders/approvals/${mine!.id}/reject`, { data: { reason: "Test tidy-up" } }));
    } finally {
      await cashier.dispose();
      await page.context().close();
    }
  });

  test("payment waits for a decision, and only the counter can make one", async ({ baseURL }) => {
    const waiter = await api("waiter", baseURL);
    const cashier = await api("cashier", baseURL);
    try {
      const { order } = await placeDineIn(waiter, owner);
      const [request] = await pendingFor(cashier, order.id);

      const pay = await cashier.post(`/api/orders/${order.id}/pay`, {
        data: { tenders: [{ method: "CASH", amountPaisa: 10_000_000 }] },
      });
      expect(pay.status(), "no paying for food the kitchen never saw").toBe(409);
      expect(await pay.text()).toContain("waiting for approval");

      expect(
        (await waiter.post(`/api/orders/approvals/${request.id}/approve`)).status(),
        "a waiter can't approve their own",
      ).toBe(403);
      expect((await waiter.get("/api/orders/approvals")).status()).toBe(403);

      // Deciding twice: the second tap is told it's done, not applied again.
      await ok(await cashier.post(`/api/orders/approvals/${request.id}/approve`));
      expect((await cashier.post(`/api/orders/approvals/${request.id}/approve`)).status()).toBe(409);
      expect((await orderNow(owner, order.id)).status).toBe("SENT_TO_KITCHEN");
    } finally {
      await waiter.dispose();
      await cashier.dispose();
    }
  });

  test("with the switch off, a waiter's order goes straight to the kitchen", async ({ baseURL }) => {
    const waiter = await api("waiter", baseURL);
    try {
      await setApprovals(owner, false);
      const { order, awaitingApproval } = await placeDineIn(waiter, owner);
      expect(awaitingApproval).toBe(false);
      expect((await orderNow(owner, order.id)).status).toBe("SENT_TO_KITCHEN");
    } finally {
      await waiter.dispose();
    }
  });
});
