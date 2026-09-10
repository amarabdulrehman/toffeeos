import "dotenv/config";
import { test, expect } from "@playwright/test";
import { authFile, TENANT_SLUG } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * Daily cash drawer: opening float, counted close, and the variance between them.
 *
 * The variance is the entire point of the feature, so most of what is asserted here is that it
 * cannot be quietly made to disappear — not by reopening a day, not by closing twice, and not by
 * counting card payments that never touched the till.
 */

async function branchId(): Promise<string> {
  return withDb(async (c) =>
    (
      await c.query(
        'SELECT b.id FROM "Branch" b JOIN "Tenant" t ON b."tenantId" = t.id WHERE t.slug = $1 ORDER BY b."createdAt" LIMIT 1',
        [TENANT_SLUG]
      )
    ).rows[0].id as string
  );
}

/** Removes any drawer row for the day under test so each run starts from "not opened". */
async function clearDay(bid: string, day: string) {
  await withDb((c) => c.query('DELETE FROM "CashDrawerDay" WHERE "branchId" = $1 AND "businessDate" = $2', [bid, day]));
}

/** A past date, so the test never collides with real activity on today's drawer. */
const DAY = "2019-03-14";

test.describe("Cash drawer", () => {
  test.use({ storageState: authFile("owner") });

  test.beforeEach(async () => {
    await clearDay(await branchId(), DAY);
  });

  test.afterAll(async () => {
    await clearDay(await branchId(), DAY);
  });

  test("opens with a float, closes with a count, and records the difference", async ({ request }) => {
    const open = await request.post("/api/cash-drawer", {
      data: { businessDate: DAY, openingBalancePaisa: 500_000 },
    });
    expect(open.ok(), await open.text()).toBeTruthy();
    const opened = (await open.json()).day;
    expect(opened.openingBalancePaisa).toBe(500_000);
    expect(opened.isOpen).toBe(true);
    // No sales on a date this old, so the expectation is exactly the float.
    expect(opened.expectedClosingPaisa).toBe(500_000);
    expect(opened.variancePaisa).toBeNull();

    // Counted Rs 4,900 against an expected Rs 5,000 — a hundred rupees short.
    const close = await request.patch("/api/cash-drawer", {
      data: { businessDate: DAY, closingCountedPaisa: 490_000, note: "short, checked twice" },
    });
    expect(close.ok(), await close.text()).toBeTruthy();
    const closed = (await close.json()).day;
    expect(closed.closingCountedPaisa).toBe(490_000);
    expect(closed.variancePaisa).toBe(-10_000);
    expect(closed.isOpen).toBe(false);
    expect(closed.closedByName).toBeTruthy();
  });

  test("a day cannot be opened twice", async ({ request }) => {
    await request.post("/api/cash-drawer", { data: { businessDate: DAY, openingBalancePaisa: 100_000 } });

    // Reopening would rewrite the float the day is reconciled against. Unlike closing, there is no
    // correction path for this — the opening float is what a day is reconciled *against*, not a
    // figure that itself gets reconciled.
    const reopen = await request.post("/api/cash-drawer", {
      data: { businessDate: DAY, openingBalancePaisa: 999_999 },
    });
    expect(reopen.status()).toBe(409);
    const still = await request.get(`/api/cash-drawer?businessDate=${DAY}`);
    expect((await still.json()).day.openingBalancePaisa).toBe(100_000);
  });

  test("closing a day twice without pos.cashDrawer.correctClose is refused", async ({ browser, baseURL }) => {
    // Cashier holds pos.shift.close (can do the ordinary close) but not the dedicated correction
    // permission — an ordinary second close from the same role that closed it must still be refused,
    // not silently treated as a correction.
    const ctx = await browser.newContext({ baseURL, storageState: authFile("cashier") });
    try {
      await ctx.request.post("/api/cash-drawer", { data: { businessDate: DAY, openingBalancePaisa: 100_000 } });
      await ctx.request.patch("/api/cash-drawer", { data: { businessDate: DAY, closingCountedPaisa: 90_000 } });
      const reclose = await ctx.request.patch("/api/cash-drawer", {
        data: { businessDate: DAY, closingCountedPaisa: 100_000 },
      });
      expect(reclose.status()).toBe(409);
      const after = await ctx.request.get(`/api/cash-drawer?businessDate=${DAY}`);
      expect((await after.json()).day.variancePaisa).toBe(-10_000);
    } finally {
      await ctx.close();
    }
  });

  test("an owner can correct a closed day's count without erasing who originally closed it", async ({ request }) => {
    await request.post("/api/cash-drawer", { data: { businessDate: DAY, openingBalancePaisa: 100_000 } });
    const firstClose = await request.patch("/api/cash-drawer", {
      data: { businessDate: DAY, closingCountedPaisa: 90_000, note: "short, checked twice" },
    });
    expect(firstClose.ok(), await firstClose.text()).toBeTruthy();
    const firstBody = await firstClose.json();
    expect(firstBody.isCorrection).toBe(false);
    const originalClosedByName = firstBody.day.closedByName;
    const originalClosedAt = firstBody.day.closedAt;

    // Owner holds pos.cashDrawer.correctClose — a second close from Owner is a correction, not a
    // rejected duplicate.
    const correction = await request.patch("/api/cash-drawer", {
      data: { businessDate: DAY, closingCountedPaisa: 100_000, note: "typo — recounted, exact" },
    });
    expect(correction.ok(), await correction.text()).toBeTruthy();
    const body = await correction.json();
    expect(body.isCorrection).toBe(true);
    expect(body.previousClosingCountedPaisa).toBe(90_000);
    expect(body.day.closingCountedPaisa).toBe(100_000);
    expect(body.day.variancePaisa).toBe(0);
    // The original close is preserved, not overwritten by the correction.
    expect(body.day.closedByName).toBe(originalClosedByName);
    expect(body.day.closedAt).toBe(originalClosedAt);
    expect(body.day.correctedByName).toBeTruthy();
    expect(body.day.correctedAt).toBeTruthy();

    const after = await request.get(`/api/cash-drawer?businessDate=${DAY}`);
    const day = (await after.json()).day;
    expect(day.closingCountedPaisa).toBe(100_000);
    expect(day.variancePaisa).toBe(0);
  });

  test("closing a day that was never opened is refused", async ({ request }) => {
    const res = await request.patch("/api/cash-drawer", {
      data: { businessDate: DAY, closingCountedPaisa: 50_000 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/never opened/i);
  });

  test("rejects a negative float and a malformed date", async ({ request }) => {
    const negative = await request.post("/api/cash-drawer", {
      data: { businessDate: DAY, openingBalancePaisa: -1 },
    });
    expect(negative.status()).toBe(400);

    // The date reaches a unique key and a range query, so a wrong shape must not get through.
    const badDate = await request.post("/api/cash-drawer", {
      data: { businessDate: "2026-02-31", openingBalancePaisa: 1000 },
    });
    expect(badDate.status()).toBe(400);
  });

  test("only cash counts toward the drawer", async ({ request }) => {
    // A card sale is real revenue that never passes through the till. If it were counted, every
    // drawer would show a false surplus and the variance would stop meaning anything.
    const bid = await branchId();
    const orderId = `e2e-drawer-${Date.now()}`;
    const { from } = { from: `${DAY}T06:00:00.000Z` };
    await withDb(async (c) => {
      const tenantId = (
        await c.query('SELECT "tenantId" FROM "Branch" WHERE id = $1', [bid])
      ).rows[0].tenantId as string;
      await c.query(
        `INSERT INTO "Order" (id, "idempotencyKey", "tenantId", "branchId", "orderNumber", type, status, source,
           "subtotalPaisa", "discountedSubtotalPaisa", "totalPaisa", "paidPaisa", "paidAt", "createdAt", "updatedAt")
         VALUES ($1, $1, $2, $3, 999001, 'DINE_IN', 'PAID', 'POS', 200000, 200000, 200000, 200000, $4, $4, $4)`,
        [orderId, tenantId, bid, from]
      );
      await c.query(
        `INSERT INTO "Payment" (id, "tenantId", "orderId", method, "amountPaisa", "taxRateBasisPoints", "createdAt")
         VALUES (gen_random_uuid(), $1, $2, 'CARD', 200000, 0, $3)`,
        [tenantId, orderId, from]
      );
    });

    try {
      const res = await request.get(`/api/cash-drawer?businessDate=${DAY}`);
      const day = (await res.json()).day;
      expect(day.cashSalesPaisa, "a card payment must not appear as cash in the drawer").toBe(0);
    } finally {
      await withDb(async (c) => {
        await c.query('DELETE FROM "Payment" WHERE "orderId" = $1', [orderId]);
        await c.query('DELETE FROM "Order" WHERE id = $1', [orderId]);
      });
    }
  });

  test("a waiter cannot open or close the drawer", async ({ browser, baseURL }) => {
    // pos.shift.open/close are cashier-and-up; a waiter holds neither.
    const ctx = await browser.newContext({ baseURL, storageState: authFile("waiter") });
    try {
      const open = await ctx.request.post("/api/cash-drawer", {
        data: { businessDate: DAY, openingBalancePaisa: 100_000 },
      });
      expect(open.status()).toBe(403);
      const read = await ctx.request.get(`/api/cash-drawer?businessDate=${DAY}`);
      expect(read.status()).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
