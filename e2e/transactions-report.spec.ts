import "dotenv/config";
import { test, expect } from "@playwright/test";
import { authFile } from "./fixtures/test-data";

/**
 * The transactions report — every individual sale behind the Sales tab's totals.
 *
 * The property that matters most is that the two agree. A detail view whose rows do not add up to
 * the summary sitting above it is worse than no detail view at all, so that is asserted directly
 * rather than assumed from the fact that both call paidOrdersWhere.
 */

function range(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}

test.describe("Transactions report", () => {
  test.use({ storageState: authFile("owner") });

  test("every row is a real paid sale, and the rows sum to the sales total", async ({ request }) => {
    const qs = range(120);
    const [txRes, salesRes] = await Promise.all([
      request.get(`/api/reports/transactions?${qs}`),
      request.get(`/api/reports/sales-summary?${qs}`),
    ]);
    expect(txRes.ok(), await txRes.text()).toBeTruthy();
    expect(salesRes.ok()).toBeTruthy();

    const tx = await txRes.json();
    const sales = await salesRes.json();

    // Skipped rather than failed on an empty window: this asserts a relationship between two
    // reports, and with no orders both are trivially zero and prove nothing.
    test.skip(tx.rows.length === 0, "no paid orders in the window to compare");

    // The headline check. Only holds while the report is not truncated, since the summary counts
    // every order and the detail is capped.
    if (!tx.truncated) {
      expect(tx.rows.length, "one row per paid order").toBe(sales.orderCount);
      expect(tx.totalPaisa, "the itemised rows must add up to the sales total").toBe(sales.totalPaisa);
    }

    for (const row of tx.rows) {
      expect(row.orderNumber).toBeGreaterThan(0);
      expect(new Date(row.paidAt).toString()).not.toBe("Invalid Date");
      expect(row.branchName).toBeTruthy();
      expect(row.totalPaisa).toBeGreaterThanOrEqual(0);
      // Every money column is an integer paisa value, never a float that survived a rupee
      // conversion somewhere upstream.
      for (const key of ["subtotalPaisa", "discountPaisa", "taxPaisa", "totalPaisa"]) {
        expect(Number.isInteger(row[key]), `${key} must be integer paisa`).toBe(true);
      }
    }
  });

  test("is ordered newest first, so today's sales are at the top", async ({ request }) => {
    const res = await request.get(`/api/reports/transactions?${range(120)}`);
    const { rows } = await res.json();
    test.skip(rows.length < 2, "needs at least two sales to have an order");

    const times = rows.map((r: { paidAt: string }) => new Date(r.paidAt).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  test("reports its own cap rather than silently truncating", async ({ request }) => {
    const res = await request.get(`/api/reports/transactions?${range(120)}`);
    const body = await res.json();
    // Whatever the data volume, the caller can always tell whether it is seeing everything.
    expect(typeof body.truncated).toBe("boolean");
    expect(body.rows.length).toBeLessThanOrEqual(body.limit);
  });

  test("a kitchen user cannot read the day's sales", async ({ browser, baseURL }) => {
    // Itemised takings are exactly the thing reports.sales.view exists to gate.
    const ctx = await browser.newContext({ baseURL, storageState: authFile("kitchen") });
    try {
      const res = await ctx.request.get(`/api/reports/transactions?${range(7)}`);
      expect(res.status()).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
