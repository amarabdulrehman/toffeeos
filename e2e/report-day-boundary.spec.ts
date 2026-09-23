import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";
import { withDb } from "./fixtures/platform-admin";

/**
 * A sale belongs to the day it happened on in the café, not in Greenwich.
 *
 * The reports resolved their *range* in the branch's timezone, but grouped the sales inside it by
 * UTC date. Pakistan is UTC+5, so anything paid between midnight and 5am landed on the previous
 * day — a café that trades past midnight saw its whole late shift reported against the wrong date,
 * and a report for one day could come back with a row dated the day before, outside the range it
 * was asked for.
 *
 * Pinned with a sale moved to 1:30am local time, the window where the two clocks disagree.
 */

// 01:30 in Karachi on 11 March 2025 is 20:30 UTC on 10 March — same instant, different date.
const LOCAL_DAY = "2025-03-11";
const UTC_DAY = "2025-03-10";
const INSTANT = "2025-03-10T20:30:00.000Z";

test.describe("Report day boundaries", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("a sale at 1:30am is reported on that day, not the day before", async ({ request }) => {
    const menuItemId = await getMenuItemId(request, "Fish Pakora");
    const created = await request.post("/api/orders", {
      data: { type: "TAKEAWAY", idempotencyKey: `day-boundary-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const order = (await created.json()).order;
    const paid = await request.post(`/api/orders/${order.id}/pay`, {
      data: { tenders: [{ method: "CASH", amountPaisa: order.totalPaisa }] },
    });
    expect(paid.ok(), await paid.text()).toBeTruthy();

    // There is no API for backdating a payment, rightly, so this is done in the database.
    await withDb((c) => c.query(`UPDATE "Order" SET "paidAt" = $1 WHERE id = $2`, [INSTANT, order.id]));

    const range = `from=${LOCAL_DAY}&to=${LOCAL_DAY}`;

    // Staff performance, grouped by cashier and day.
    const staff = await request.get(`/api/reports/staff-performance?${range}`);
    expect(staff.ok(), await staff.text()).toBeTruthy();
    const staffRows = (await staff.json()).rows as { staffId: string; day: string; orders: number }[];
    const mine = staffRows.filter((r) => r.staffId === order.createdById);
    expect(mine.length, "the sale is inside this range, so its cashier should appear").toBeGreaterThan(0);
    for (const row of mine) {
      expect(row.day, `a report for ${LOCAL_DAY} cannot contain a row dated ${UTC_DAY}`).toBe(LOCAL_DAY);
    }

    // Sales summary, grouped by day.
    const sales = await request.get(`/api/reports/sales-summary?${range}`);
    expect(sales.ok(), await sales.text()).toBeTruthy();
    const byDay = (await sales.json()).byDay as { day: string; orders: number }[];
    expect(byDay.map((d) => d.day), "every bucket should carry the local date").not.toContain(UTC_DAY);
    expect(byDay.find((d) => d.day === LOCAL_DAY)?.orders ?? 0).toBeGreaterThan(0);
  });
});
