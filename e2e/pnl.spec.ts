import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * Cash-basis P&L. The assertions here are mostly about *internal consistency* — that the P&L can't
 * quietly disagree with the screens it's derived from — because those are the failures a reader
 * would never catch by eye but would destroy trust in every number on the page.
 */

interface Pnl {
  grossSalesPaisa: number;
  refundsPaisa: number;
  salesTaxPaisa: number;
  netRevenuePaisa: number;
  orderCount: number;
  stockPurchasesPaisa: number;
  stockPurchasesMissingCost: number;
  salariesPaisa: number;
  expensesPaisa: number;
  expensesByCategory: { category: string; amountPaisa: number }[];
  totalCostsPaisa: number;
  netProfitPaisa: number;
  marginPct: number | null;
}

/** A range wide enough to cover the seeded demo history plus anything a test just created. */
function wideRange() {
  const from = "2024-01-01";
  const to = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)).toISOString().slice(0, 10);
  return `from=${from}&to=${to}`;
}

test.describe("P&L report", () => {
  test.use({ storageState: authFile("owner") });

  test("gross sales matches the Sales tab exactly for the same range", async ({ request }) => {
    // Both read through the shared paidOrdersWhere() filter; this is the assertion that keeps them
    // from drifting if either query is edited later.
    const qs = wideRange();
    const [pnlRes, salesRes] = await Promise.all([
      request.get(`/api/reports/pnl?${qs}`),
      request.get(`/api/reports/sales-summary?${qs}`),
    ]);
    expect(pnlRes.ok(), await pnlRes.text()).toBeTruthy();
    expect(salesRes.ok(), await salesRes.text()).toBeTruthy();

    const pnl: Pnl = await pnlRes.json();
    const sales = await salesRes.json();

    expect(pnl.grossSalesPaisa).toBe(sales.totalPaisa);
    expect(pnl.orderCount).toBe(sales.orderCount);
  });

  test("revenue excludes sales tax and every subtotal is internally consistent", async ({ request }) => {
    const res = await request.get(`/api/reports/pnl?${wideRange()}`);
    const pnl: Pnl = await res.json();

    // Tax is collected for the PRA and remitted — it must never be counted as income. Refunds come
    // off the same line: this identity is what silently stopped holding when refunds were added and
    // this report was not told about them.
    expect(pnl.netRevenuePaisa).toBe(pnl.grossSalesPaisa - pnl.refundsPaisa - pnl.salesTaxPaisa);
    expect(pnl.salesTaxPaisa).toBeGreaterThan(0); // the demo tenant has PRA rules and paid orders
    expect(pnl.netRevenuePaisa).toBeLessThan(pnl.grossSalesPaisa);

    expect(pnl.totalCostsPaisa).toBe(pnl.stockPurchasesPaisa + pnl.salariesPaisa + pnl.expensesPaisa);
    expect(pnl.netProfitPaisa).toBe(pnl.netRevenuePaisa - pnl.totalCostsPaisa);

    // The category breakdown must account for the whole expense line, not just part of it.
    const byCategorySum = pnl.expensesByCategory.reduce((a, c) => a + c.amountPaisa, 0);
    expect(byCategorySum).toBe(pnl.expensesPaisa);

    if (pnl.netRevenuePaisa > 0) {
      expect(pnl.marginPct).toBeCloseTo((pnl.netProfitPaisa / pnl.netRevenuePaisa) * 100, 6);
    }

    // Every money field is integer paisa — a float here means a rounding bug upstream.
    for (const [k, v] of Object.entries(pnl)) {
      if (k.endsWith("Paisa")) expect(Number.isInteger(v), `${k} must be an integer`).toBe(true);
    }
  });

  test("a refund comes off profit, along with the tax that went back with it", async ({ request }) => {
    /**
     * This report summed Order.totalPaisa and stopped. Refunds were added without it being told,
     * so every rupee handed back to a customer still counted as profit — and the Sales tab beside
     * it, which has always netted refunds, quoted a different number for the same range.
     *
     * A refund is a slice of a tax-inclusive order, so its tax share goes back too. Asserting the
     * split rather than just "profit went down" is the point: taking the whole refund off gross
     * while leaving tax untouched is the obvious wrong fix and would over-correct by exactly this
     * amount.
     */
    const qs = wideRange();
    const menuItemId = await getMenuItemId(request, "Fish Pakora");

    const created = await request.post("/api/orders", {
      data: { type: "TAKEAWAY", idempotencyKey: `pnl-refund-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 2 }] },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const order = (await created.json()).order;

    const paid = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: order.totalPaisa }] },
    });
    expect(paid.ok(), await paid.text()).toBeTruthy();
    const settled = (await paid.json()).order;

    const before: Pnl = await (await request.get(`/api/reports/pnl?${qs}`)).json();

    const refundPaisa = Math.floor(settled.paidPaisa / 2);
    const refunded = await request.post(`/api/orders/${order.id}/refund`, {
      data: { amountPaisa: refundPaisa, method: "CASH", reason: "pnl netting probe" },
    });
    expect(refunded.ok(), await refunded.text()).toBeTruthy();

    const after: Pnl = await (await request.get(`/api/reports/pnl?${qs}`)).json();

    // The same apportionment the report does, computed here from the order's own numbers.
    const refundedTaxPaisa = Math.round((refundPaisa * settled.taxPaisa) / settled.totalPaisa);

    expect(after.grossSalesPaisa, "gross is what was rung up and does not move").toBe(before.grossSalesPaisa);
    expect(after.refundsPaisa - before.refundsPaisa, "the refund is reported in full").toBe(refundPaisa);
    expect(after.salesTaxPaisa - before.salesTaxPaisa, "tax owed drops by the refund's share").toBe(-refundedTaxPaisa);
    expect(
      after.netProfitPaisa - before.netProfitPaisa,
      "profit falls by the refund less the tax that was never the restaurant's"
    ).toBe(-(refundPaisa - refundedTaxPaisa));
  });

  test("a recorded expense increases costs and reduces profit by exactly its amount", async ({ request }) => {
    const qs = wideRange();
    const before: Pnl = await (await request.get(`/api/reports/pnl?${qs}`)).json();

    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E PnL ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    const amountPaisa = 77_777;
    const createRes = await request.post("/api/expenses", {
      data: { categoryId: category.id, amountPaisa, spentAt: new Date().toISOString() },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const expense = await createRes.json();

    const after: Pnl = await (await request.get(`/api/reports/pnl?${qs}`)).json();

    expect(after.expensesPaisa).toBe(before.expensesPaisa + amountPaisa);
    expect(after.totalCostsPaisa).toBe(before.totalCostsPaisa + amountPaisa);
    expect(after.netProfitPaisa).toBe(before.netProfitPaisa - amountPaisa);
    // Revenue must be completely untouched by an expense.
    expect(after.grossSalesPaisa).toBe(before.grossSalesPaisa);

    const row = after.expensesByCategory.find((c) => c.category === category.name);
    expect(row?.amountPaisa).toBe(amountPaisa);

    await request.delete(`/api/expenses/${expense.id}`);

    // ...and removing it puts every figure back exactly where it started.
    const restored: Pnl = await (await request.get(`/api/reports/pnl?${qs}`)).json();
    expect(restored.expensesPaisa).toBe(before.expensesPaisa);
    expect(restored.netProfitPaisa).toBe(before.netProfitPaisa);
  });

  test("an expense dated outside the range is excluded", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E PnLRange ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    // Spent in 2025; the window below is 2026 only.
    await request.post("/api/expenses", {
      data: {
        categoryId: category.id,
        amountPaisa: 500_000,
        spentAt: new Date(Date.UTC(2025, 2, 10)).toISOString(),
      },
    });

    const res = await request.get(`/api/reports/pnl?from=2026-01-01&to=2026-12-31`);
    const pnl: Pnl = await res.json();

    expect(pnl.expensesByCategory.some((c) => c.category === category.name)).toBe(false);
  });

  test("stockPurchasesMissingCost is reported so an understated cost line is visible", async ({ request }) => {
    const res = await request.get(`/api/reports/pnl?${wideRange()}`);
    const pnl: Pnl = await res.json();
    // The field must always be present and sane — it's the honesty signal on the stock line.
    expect(Number.isInteger(pnl.stockPurchasesMissingCost)).toBe(true);
    expect(pnl.stockPurchasesMissingCost).toBeGreaterThanOrEqual(0);
  });
});

test.describe("P&L — permission enforcement", () => {
  test.use({ storageState: authFile("cashier") });

  test("a cashier cannot read the P&L", async ({ request }) => {
    const res = await request.get(`/api/reports/pnl?${wideRange()}`);
    expect(res.status()).toBe(403);
  });
});
