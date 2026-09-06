import "dotenv/config";
import { request as playwrightRequest, type FullConfig } from "@playwright/test";
import { Client } from "pg";
import { authFile } from "./fixtures/test-data";

/**
 * Staff accounts the suite creates: the invite spec's accepted hires, and the throwaway staff the
 * PENDING-approval and session-revocation specs each need. All are created fresh per run and none
 * has a delete endpoint, so without this they accumulate one per run forever — 13 had piled up in
 * the demo tenant's staff list before this was added. Scoped to the suite's own address patterns,
 * so a real staff member is never matched.
 */
async function purgeTestStaff() {
  if (!process.env.DIRECT_URL) return;
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  const where = `(email LIKE 'e2e-invite-%@example.com' OR email LIKE 'e2e-recorder%' OR email LIKE 'e2e-revoke-%')`;
  try {
    await c.connect();
    // Children first — StaffPin and Membership both hold a real FK to User.
    await c.query(`DELETE FROM "StaffPin" WHERE "userId" IN (SELECT id FROM "User" WHERE ${where})`);
    await c.query(`DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE ${where})`);
    await c.query(`DELETE FROM "Invite" WHERE email LIKE 'e2e-invite-%@example.com'`);
    await c.query(`DELETE FROM "User" WHERE ${where}`);
  } catch {
    // Best-effort, exactly like the template purge below.
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * tenant-isolation.spec.ts provisions a whole real tenant per run to prove isolation against, and
 * never removed it — 17 had piled up, all still TRIALING, so they counted as live trials in the
 * super-admin panel and in any tenant total.
 *
 * Cancelled rather than deleted, deliberately. The schema has no `onDelete: Cascade` anywhere, so
 * removing a Tenant means hand-ordering deletes across ~20 tables; getting that wrong on a shared
 * production database is a far worse outcome than leaving inert rows behind. CANCELLED drops them
 * out of every active count and blocks login, which is the whole practical problem.
 *
 * Matched on the machine-generated slug prefix the spec itself uses, so a real tenant cannot be hit.
 */
async function retireTestTenants() {
  if (!process.env.DIRECT_URL) return;
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  try {
    await c.connect();
    await c.query(
      `UPDATE "Tenant" SET status = 'CANCELLED'
        WHERE slug LIKE 'isolation-test-%' AND status <> 'CANCELLED'`
    );
  } catch {
    // Best-effort, like the other purges here.
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * Recurring-expense templates can only be deactivated through the API, never deleted — a generated
 * Expense keeps a recurringExpenseId pointing at its template, so the row has to survive. That's
 * right for real data but means each suite run would leave one more "Stopped" template cluttering
 * the demo tenant's Recurring tab forever. This is the one bit of cleanup that has to go below the
 * API, and it's deliberately narrow: only templates whose category is an "E2E " one AND which have
 * generated nothing (so no expense can be orphaned) are removed.
 */
async function purgeTestRecurringTemplates() {
  if (!process.env.DIRECT_URL) return;
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  try {
    await c.connect();
    await c.query(
      `DELETE FROM "RecurringExpense" r
        USING "ExpenseCategory" c
        WHERE r."categoryId" = c.id
          AND c.name LIKE 'E2E %'
          AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."recurringExpenseId" = r.id)`
    );
  } catch {
    // Cleanup is best-effort: a teardown failure must never fail an otherwise-green suite.
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * Runs once after the whole suite. Several specs deliberately leave orders SENT_TO_KITCHEN/READY
 * (that's the state under test) and tables OCCUPIED — without this, every run permanently eats a
 * few tables from the demo branch's fixed pool until none are AVAILABLE (see the overnight
 * hardening session's notes on exactly that happening during manual testing). Voiding is the right
 * cleanup, not paying: these are synthetic test orders, not real revenue, and PAID orders are kept
 * around elsewhere in this database as real-looking demo history — voiding avoids polluting that.
 */
export default async function globalTeardown(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3100";
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });

  try {
    const ordersRes = await ctx.get("/api/orders");
    if (!ordersRes.ok()) return;
    const { orders } = await ordersRes.json();

    const openOrders = orders.filter((o: { status: string }) =>
      ["OPEN", "SENT_TO_KITCHEN", "READY"].includes(o.status)
    );
    for (const o of openOrders) {
      await ctx.post(`/api/orders/${o.id}/void`, { data: { reason: "E2E suite cleanup" } }).catch(() => {});
    }

    // Expense rows the suite created. Named with an "E2E " category prefix and a unique suffix, so
    // this only ever touches the suite's own data — a real expense a human recorded while testing
    // is never matched. Without this, every run permanently adds rows that would skew the totals
    // shown on the Expenses screen during manual testing.
    const now = new Date();
    const from = new Date(Date.UTC(2024, 0, 1)).toISOString();
    const to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)).toISOString();
    const expensesRes = await ctx.get(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (expensesRes.ok()) {
      const { expenses } = await expensesRes.json();
      for (const e of expenses as { id: string; categoryName: string }[]) {
        if (e.categoryName.startsWith("E2E ")) {
          await ctx.delete(`/api/expenses/${e.id}`).catch(() => {});
        }
      }
    }

    // Categories can only be archived, never deleted (historical expenses depend on the row), so
    // the best available cleanup is archiving them out of the active picker. Runs after the expense
    // deletion above, since deleting an expense doesn't care whether its category is archived.
    const catRes = await ctx.get("/api/expense-categories");
    if (catRes.ok()) {
      const { categories } = await catRes.json();
      for (const c of categories as { id: string; name: string }[]) {
        if (c.name.startsWith("E2E ")) {
          await ctx.delete(`/api/expense-categories/${c.id}`).catch(() => {});
        }
      }
    }

    const tablesRes = await ctx.get("/api/tables");
    if (!tablesRes.ok()) return;
    const { floors } = await tablesRes.json();
    for (const floor of floors) {
      for (const table of floor.tables) {
        if (table.status !== "AVAILABLE") {
          await ctx.patch(`/api/tables/${table.id}/status`, { data: { status: "AVAILABLE" } }).catch(() => {});
        }
      }
    }
  } finally {
    // In the finally, not the try: several blocks above bail early with `return` when an endpoint
    // is unreachable, and this cleanup should still run in that case.
    await purgeTestRecurringTemplates();
    await purgeTestStaff();
    await retireTestTenants();
    await ctx.dispose();
  }
}
