import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * The branch's discount ceiling, end to end.
 *
 * The finding this exists for: signed in as the seeded cashier — who does *not* hold
 * pos.discount.exceedMax — a Rs 1,000 order with a 100% discount was accepted and written as a
 * Rs 0 order. The roles screen offered "Exceed maximum discount" and denying it changed nothing,
 * because no stored maximum existed for the permission to gate.
 *
 * So the properties worth pinning are not really about arithmetic (tests/discount-cap.test.ts
 * covers that) but about who the rule binds: a cashier is bound, a manager holding the permission
 * is not, and the rule survives the obvious dodge of switching the discount from a percentage to
 * the same money typed in as rupees.
 *
 * Restores the branch's original ceiling in a finally block. Leaving a 20% cap behind would fail
 * unrelated specs that discount more than that, in a way that looks nothing like its cause.
 */

const CAP_20_PCT = 2_000;
const NO_CAP = 10_000;

async function setCap(ctx: APIRequestContext, maxDiscountBasisPoints: number) {
  const res = await ctx.patch("/api/branch-settings", { data: { maxDiscountBasisPoints } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function readCap(ctx: APIRequestContext): Promise<number> {
  const res = await ctx.get("/api/branch-settings");
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  return (body.settings ?? body).maxDiscountBasisPoints;
}

/** A Rs 1,000 order: one item at its menu price, quantity chosen to be worth discounting. */
async function orderWithDiscount(
  ctx: APIRequestContext,
  menuItemId: string,
  discount: { type: "PERCENT" | "FIXED"; value: number } | undefined
) {
  return ctx.post("/api/orders", {
    data: {
      type: "TAKEAWAY",
      idempotencyKey: `cap-${uniqueSuffix()}`,
      lines: [{ menuItemId, quantity: 1 }],
      ...(discount ? { orderDiscount: discount } : {}),
    },
  });
}

test.describe("Discount ceiling", () => {
  test.describe.configure({ timeout: 150_000 });

  let owner: APIRequestContext;
  let cashier: APIRequestContext;
  let menuItemId: string;
  let originalCap = NO_CAP;

  test.beforeAll(async ({ baseURL }) => {
    owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    menuItemId = await getMenuItemId(owner, "Fish Pakora");
    originalCap = await readCap(owner);
  });

  test.afterAll(async () => {
    await setCap(owner, originalCap);
    await owner.dispose();
    await cashier.dispose();
  });

  test("with no cap set, a cashier really can take the whole bill off", async () => {
    // Pinning the old behaviour deliberately. The default is 100% precisely so that deploying this
    // changes nothing for a branch that has not configured a ceiling — if that ever stops being
    // true, every existing client starts refusing discounts they allowed yesterday, and this test
    // is where that would show up.
    await setCap(owner, NO_CAP);

    const res = await orderWithDiscount(cashier, menuItemId, { type: "PERCENT", value: 10_000 });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect((await res.json()).order.totalPaisa, "100% off with no cap should still be allowed").toBe(0);
  });

  test("with a cap set, the same order from the same cashier is refused", async () => {
    await setCap(owner, CAP_20_PCT);

    const res = await orderWithDiscount(cashier, menuItemId, { type: "PERCENT", value: 10_000 });
    expect(res.status(), "a 100% discount must be refused under a 20% ceiling").toBe(403);
    expect(await res.text()).toMatch(/20% limit/i);
  });

  test("the same money typed as rupees is refused too", async () => {
    // The dodge that would make the whole feature decorative: leave the percentage alone and put
    // the amount in the FIXED box instead.
    await setCap(owner, CAP_20_PCT);

    const menu = await (await owner.get("/api/menu")).json();
    const item = (menu.categories as { items: { id: string; basePricePaisa: number }[] }[])
      .flatMap((c) => c.items)
      .find((i) => i.id === menuItemId);
    expect(item, "need the item's price to size a FIXED discount").toBeTruthy();

    const res = await orderWithDiscount(cashier, menuItemId, {
      type: "FIXED",
      value: Math.round(item!.basePricePaisa * 0.9),
    });
    expect(res.status(), "90% of the bill as a rupee figure must be refused too").toBe(403);
  });

  test("a discount inside the cap still goes through", async () => {
    // The fix must not break the ordinary case — a cashier giving a normal discount.
    await setCap(owner, CAP_20_PCT);

    const res = await orderWithDiscount(cashier, menuItemId, { type: "PERCENT", value: 1_000 });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect((await res.json()).order.totalPaisa, "10% off under a 20% cap should be allowed").toBeGreaterThan(0);
  });

  test("the owner, who may exceed it, is not bound", async () => {
    // The permission finally gates something. The owner holds pos.discount.exceedMax, so the same
    // request the cashier was refused must succeed.
    await setCap(owner, CAP_20_PCT);

    const res = await orderWithDiscount(owner, menuItemId, { type: "PERCENT", value: 10_000 });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect((await res.json()).order.totalPaisa).toBe(0);
  });

  test("an order with no discount is unaffected by any cap", async () => {
    await setCap(owner, 0);

    const res = await orderWithDiscount(cashier, menuItemId, undefined);
    expect(res.ok(), await res.text()).toBeTruthy();
    expect((await res.json()).order.totalPaisa).toBeGreaterThan(0);
  });
});
