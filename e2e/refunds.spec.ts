import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * Giving money back.
 *
 * There was no way to reverse a paid order at all: `pos.payment.refund` was a permission string
 * with nothing behind it, and PAID is terminal so voiding was refused by design. Every correction —
 * a returned dish, a double charge, a wrongly rung-up bill — had to be settled in cash off-system,
 * after which the day's reports and the till disagreed and nobody could say why.
 *
 * What is worth pinning is not that a row gets written but that the money adds up afterwards: you
 * cannot give back more than was taken, not twice, not by someone whose role forbids it, and a cash
 * refund has to leave the drawer or the count at close is wrong.
 */

/** Punches an order and pays it in full, returning the order and what it cost. */
async function paidOrder(ctx: APIRequestContext, menuItemId: string) {
  const created = await ctx.post("/api/orders", {
    data: {
      type: "TAKEAWAY",
      idempotencyKey: `refund-${uniqueSuffix()}`,
      lines: [{ menuItemId, quantity: 1 }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const order = (await created.json()).order;

  const paid = await ctx.post(`/api/orders/${order.id}/pay`, {
    data: { tenders: [{ method: "CASH", amountPaisa: order.totalPaisa }] },
  });
  expect(paid.ok(), await paid.text()).toBeTruthy();
  const settled = (await paid.json()).order;

  return { id: order.id as string, totalPaisa: settled.totalPaisa as number, paidPaisa: settled.paidPaisa as number };
}

test.describe("Refunds", () => {
  test.describe.configure({ timeout: 150_000 });

  let owner: APIRequestContext;
  let cashier: APIRequestContext;
  let menuItemId: string;

  test.beforeAll(async ({ baseURL }) => {
    owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    menuItemId = await getMenuItemId(owner, "Fish Pakora");
  });

  test.afterAll(async () => {
    await owner.dispose();
    await cashier.dispose();
  });

  test("a full refund returns the money and is recorded against the order", async () => {
    const order = await paidOrder(owner, menuItemId);

    const res = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: order.paidPaisa, method: "CASH", reason: "dish returned" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();

    expect(body.order.refundedPaisa, "the order should carry what was given back").toBe(order.paidPaisa);
    // paidPaisa is deliberately untouched: what was taken and what was returned are separate facts,
    // and an order that reads "paid 0" cannot be told apart from one nobody ever paid.
    expect(body.order.paidPaisa, "what was taken is not rewritten").toBe(order.paidPaisa);

    const listed = await owner.get(`/api/orders/${order.id}/refund`);
    expect(listed.ok()).toBeTruthy();
    const refunds = (await listed.json()).refunds;
    expect(refunds).toHaveLength(1);
    expect(refunds[0].reason).toBe("dish returned");
    expect(refunds[0].amountPaisa).toBe(order.paidPaisa);
  });

  test("partial refunds accumulate and stop exactly at what was paid", async () => {
    const order = await paidOrder(owner, menuItemId);
    const half = Math.floor(order.paidPaisa / 2);

    const first = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: half, method: "CASH", reason: "one item sent back" },
    });
    expect(first.ok(), await first.text()).toBeTruthy();
    expect((await first.json()).order.refundedPaisa).toBe(half);

    // One paisa more than remains must be refused — this is the arithmetic that stops an order
    // being refunded for more than it ever earned, one small refund at a time.
    const tooMuch = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: order.paidPaisa - half + 1, method: "CASH", reason: "over by one" },
    });
    expect(tooMuch.status(), "refunding past what was paid must be refused").toBe(400);
    expect(await tooMuch.text()).toMatch(/more than is left/i);

    const rest = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: order.paidPaisa - half, method: "CASH", reason: "the rest" },
    });
    expect(rest.ok(), await rest.text()).toBeTruthy();
    expect((await rest.json()).order.refundedPaisa).toBe(order.paidPaisa);

    const done = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: 100, method: "CASH", reason: "again" },
    });
    expect(done.status(), "a fully refunded order takes no more").toBe(400);
    expect(await done.text()).toMatch(/already been fully refunded/i);
  });

  test("an unpaid order cannot be refunded", async () => {
    // Correcting an unpaid order is voiding it, which is different bookkeeping. Refunding one would
    // hand out money that was never taken.
    const created = await owner.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `unpaid-${uniqueSuffix()}`,
        lines: [{ menuItemId, quantity: 1 }],
      },
    });
    const order = (await created.json()).order;

    const res = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: 100, method: "CASH", reason: "should not work" },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/nothing has been paid/i);
  });

  test("a refund needs a reason and a positive amount", async () => {
    const order = await paidOrder(owner, menuItemId);

    const noReason = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: 100, method: "CASH", reason: "   " },
    });
    expect(noReason.status(), "a blank reason is not a reason").toBe(400);

    const negative = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: -500, method: "CASH", reason: "negative" },
    });
    expect(negative.status(), "a negative refund would be a second charge").toBe(400);
  });

  test("a cashier without the permission cannot refund", async () => {
    // The permission finally gates something. The seeded cashier can take payment but not give it
    // back, which is the whole reason the permission exists.
    const order = await paidOrder(owner, menuItemId);

    const res = await cashier.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: 100, method: "CASH", reason: "not allowed" },
    });
    expect(res.status(), "refunding without pos.payment.refund must be refused").toBe(403);

    const listed = await owner.get(`/api/orders/${order.id}/refund`);
    expect((await listed.json()).refunds, "and nothing should have been recorded").toHaveLength(0);
  });

  test("a cash refund comes out of the drawer", async () => {
    // The reason this matters: the manager counts the till at close. If a refund left the cash box
    // but not the expected figure, every day with a refund reads as short by exactly that amount.
    //
    // Asserting expectedClosingPaisa, not just the reported refund total. An earlier version of
    // this test checked only that cashRefundsPaisa went up, and it passed with the subtraction
    // deliberately removed from the expected balance — it proved the figure was displayed, not that
    // it counted. The expected balance is the number the count is judged against, so that is the
    // one worth pinning.
    const before = await owner.get("/api/cash-drawer");
    expect(before.ok(), await before.text()).toBeTruthy();
    let day = (await before.json()).day;

    // expectedClosingPaisa is null until a drawer is opened — there is no float to count against.
    if (!day.isOpen) {
      const opened = await owner.post("/api/cash-drawer", { data: { openingBalancePaisa: 100_000 } });
      expect(opened.ok(), await opened.text()).toBeTruthy();
      day = (await opened.json()).day;
    }
    expect(day.expectedClosingPaisa, "an open drawer should have an expected balance").not.toBeNull();

    const startExpected: number = day.expectedClosingPaisa;
    const startRefunds: number = day.cashRefundsPaisa;

    const order = await paidOrder(owner, menuItemId);
    const refund = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: 5_000, method: "CASH", reason: "drawer check" },
    });
    expect(refund.ok(), await refund.text()).toBeTruthy();

    const after = await owner.get("/api/cash-drawer");
    const today = (await after.json()).day;

    expect(today.cashRefundsPaisa, "the drawer should know Rs 50 went back").toBe(startRefunds + 5_000);
    // The sale added its own cash to the drawer, so the expected balance moves by the sale less the
    // refund. Netting both is what makes this catch a refund that is reported but not subtracted.
    expect(today.expectedClosingPaisa, "the expected balance must be net of the refund").toBe(
      startExpected + order.paidPaisa - 5_000
    );
  });

  test("a card refund does not touch the drawer", async () => {
    // Only cash moves the cash box. A card refund is real money but it never sat in the till, and
    // counting it against the drawer would make an honest count look short.
    const before = await owner.get("/api/cash-drawer");
    const startRefunds = (await before.json()).day.cashRefundsPaisa;

    const order = await paidOrder(owner, menuItemId);
    const refund = await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: 5_000, method: "CARD", reason: "card back" },
    });
    expect(refund.ok(), await refund.text()).toBeTruthy();

    const after = await owner.get("/api/cash-drawer");
    expect((await after.json()).day.cashRefundsPaisa, "a card refund is not drawer cash").toBe(startRefunds);
  });

  test("the sales report reports takings net of what was given back", async () => {
    // The report is dated, and a refund is netted against the day of the *sale*, so the window has
    // to include the order this test creates.
    //
    // Widened from a single UTC "today" after it failed at ten past midnight in Karachi: the report
    // resolves its range in the *branch's* timezone, so for the five hours either side of midnight
    // UTC the two calendars disagree and the freshly-paid order fell outside the window entirely.
    // A day either side costs nothing here and removes a test that only fails at night.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const range = `?from=${day(-1)}&to=${day(1)}`;

    const before = await owner.get(`/api/reports/sales-summary${range}`);
    expect(before.ok(), await before.text()).toBeTruthy();
    const start = await before.json();

    const order = await paidOrder(owner, menuItemId);
    await owner.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: order.paidPaisa, method: "CASH", reason: "fully returned" },
    });

    const after = await owner.get(`/api/reports/sales-summary${range}`);
    const end = await after.json();

    // Gross rises by the sale; refunds rise by the same; net is unchanged. A report that only knew
    // gross would show a sale that the business did not keep a rupee of.
    expect(end.totalPaisa, "gross should include the sale").toBe(start.totalPaisa + order.totalPaisa);
    expect(end.refundedPaisa).toBe(start.refundedPaisa + order.paidPaisa);
    expect(end.netPaisa, "a sale refunded in full should add nothing to net takings").toBe(start.netPaisa);
  });
});
