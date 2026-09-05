import "dotenv/config";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { Client } from "pg";
import { TENANT_SLUG, DEMO_PASSWORD, authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * The PENDING approval path.
 *
 * No seeded role can produce a PENDING expense — owner and branch_manager both hold
 * finance.expense.approve alongside finance.expense.create, and there is no role-management UI yet.
 * But Membership.denies makes it genuinely reachable ("deny always wins", see
 * src/server/permissions/check.ts), so this builds exactly that: a recorder who may create an
 * expense but not approve one.
 *
 * What it protects is the rule the whole money side depends on: a PENDING expense is visible but
 * never counts toward a total. If that silently changed, the Expenses screen and the P&L would both
 * start quoting money nobody has approved.
 */

/** A fresh email per recorder, not a fixed one. Login is rate-limited to 8 attempts per 15 minutes
 * per email (src/server/auth/config.ts), so a reused address accumulates hits across runs and the
 * suite starts failing after the 8th run with a confusing "login must succeed". A unique address
 * gives every run its own bucket and never touches the limit. */
function recorderEmail(): string {
  return `e2e-recorder-${uniqueSuffix()}@karachikarahi.pk`;
}

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function createRecorder(): Promise<{ userId: string; email: string }> {
  const email = recorderEmail();
  const userId = await withDb(async (c) => {
    const tenant = await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG]);
    const tenantId = tenant.rows[0].id;
    const branch = await c.query(
      'SELECT id FROM "Branch" WHERE "tenantId" = $1 AND "isActive" ORDER BY "createdAt" LIMIT 1',
      [tenantId]
    );
    const role = await c.query('SELECT id FROM "Role" WHERE "tenantId" = $1 AND key = $2', [
      tenantId,
      "branch_manager",
    ]);
    // Reuse a seeded user's hash so the recorder signs in with the same DEMO_PASSWORD; this test
    // never needs to know or store a plaintext password of its own.
    const hash = await c.query('SELECT "passwordHash" FROM "User" WHERE "tenantId" = $1 AND email = $2', [
      tenantId,
      "owner@karachikarahi.pk",
    ]);

    // Sweep up anything a previous run left behind before its teardown could fire.
    await c.query(
      'DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE $1)',
      ["e2e-recorder-%"]
    );
    await c.query('DELETE FROM "User" WHERE email LIKE $1', ["e2e-recorder-%"]);

    const user = await c.query(
      'INSERT INTO "User" (id, "tenantId", email, name, "passwordHash", "isActive") ' +
        "VALUES (gen_random_uuid(), $1, $2, 'E2E Recorder', $3, true) RETURNING id",
      [tenantId, email, hash.rows[0].passwordHash]
    );

    await c.query(
      'INSERT INTO "Membership" (id, "tenantId", "userId", "branchId", "roleId", grants, denies, "isActive") ' +
        "VALUES (gen_random_uuid(), $1, $2, $3, $4, '{}', ARRAY['finance.expense.approve'], true)",
      [tenantId, user.rows[0].id, branch.rows[0].id, role.rows[0].id]
    );
    return user.rows[0].id as string;
  });
  return { userId, email };
}

async function removeRecorder(userId: string) {
  await withDb(async (c) => {
    await c.query('DELETE FROM "Membership" WHERE "userId" = $1', [userId]);
    await c.query('DELETE FROM "User" WHERE id = $1', [userId]);
  });
}

async function loginAsRecorder(baseURL: string, email: string) {
  // storageState: undefined is load-bearing. This describe block sets test.use({ storageState:
  // owner }), and that leaks into request.newContext() — without the explicit override the "fresh"
  // context arrives holding the owner's cookies, the credentials POST is ignored, and the session
  // comes back as the owner while the test believes it is the recorder.
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: undefined });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  await ctx.post("/api/auth/callback/credentials", {
    form: { tenantSlug: TENANT_SLUG, email, password: DEMO_PASSWORD, csrfToken, json: "true" },
  });
  const session = await (await ctx.get("/api/auth/session")).json();
  expect(session?.user?.email, "recorder login must succeed").toBe(email);
  return ctx;
}

function wideRangeQs(): string {
  const from = new Date(Date.UTC(2024, 0, 1)).toISOString();
  const to = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

test.describe("PENDING approval path", () => {
  test.use({ storageState: authFile("owner") });

  test("an expense recorded without approve permission lands PENDING and never counts", async ({ baseURL }) => {
    const { userId, email } = await createRecorder();
    const recorder = await loginAsRecorder(baseURL!, email);
    const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    const wide = wideRangeQs();

    try {
      const name = `E2E Pending ${uniqueSuffix()}`;
      const category = await (await owner.post("/api/expense-categories", { data: { name } })).json();

      const pnlBefore = await (await owner.get(`/api/reports/pnl?${wide}`)).json();

      const createRes = await recorder.post("/api/expenses", {
        data: { categoryId: category.id, amountPaisa: 88_800, spentAt: new Date().toISOString() },
      });
      expect(createRes.ok(), await createRes.text()).toBeTruthy();
      const expense = await createRes.json();

      // The branch under test: create without approve must not self-approve.
      expect(expense.status, "no approve permission => PENDING").toBe("PENDING");
      expect(expense.approvedById).toBeNull();
      expect(expense.approvedAt).toBeNull();

      // Visible in the log — a pending expense must not be hidden, only uncounted.
      const listed = (await (await owner.get(`/api/expenses?${wide}`)).json()).expenses.find(
        (e: { id: string }) => e.id === expense.id
      );
      expect(listed, "a PENDING expense must still be listed").toBeTruthy();
      expect(listed.status).toBe("PENDING");

      // ...but absent from every total.
      const pnlAfter = await (await owner.get(`/api/reports/pnl?${wide}`)).json();
      expect(pnlAfter.expensesPaisa, "PENDING must not reach the P&L").toBe(pnlBefore.expensesPaisa);
      expect(pnlAfter.totalCostsPaisa).toBe(pnlBefore.totalCostsPaisa);
      expect(pnlAfter.netProfitPaisa).toBe(pnlBefore.netProfitPaisa);
      expect(pnlAfter.expensesByCategory.some((c: { category: string }) => c.category === name)).toBe(false);

      await owner.delete(`/api/expenses/${expense.id}`);
    } finally {
      await recorder.dispose();
      await owner.dispose();
      await removeRecorder(userId);
    }
  });

  test("the Expenses screen shows a Pending badge but leaves it out of the total", async ({
    page,
    request,
    baseURL,
  }) => {
    const { userId, email } = await createRecorder();
    const recorder = await loginAsRecorder(baseURL!, email);

    try {
      const name = `E2E BadgeCheck ${uniqueSuffix()}`; // deliberately avoids the word the badge uses
      const category = await (await request.post("/api/expense-categories", { data: { name } })).json();
      const spentAt = new Date(Date.UTC(2026, 6, 14)).toISOString();

      // Rs 100 approved alongside Rs 900 pending, in a month nothing else uses.
      const approved = await (
        await request.post("/api/expenses", {
          data: { categoryId: category.id, amountPaisa: 10_000, spentAt },
        })
      ).json();
      const pending = await (
        await recorder.post("/api/expenses", {
          data: { categoryId: category.id, amountPaisa: 90_000, spentAt },
        })
      ).json();
      expect(pending.status).toBe("PENDING");

      // Each step waits for the /api/expenses response it triggers. Filling a date before React has
      // hydrated sets the DOM value without firing onChange, so the range silently never changes —
      // which is exactly how this test failed before, with zero rows and no error.
      const expensesLoaded = () =>
        page.waitForResponse((r) => r.url().includes("/api/expenses?") && r.status() === 200);

      await Promise.all([expensesLoaded(), page.goto("/app/expenses")]);
      await Promise.all([expensesLoaded(), page.locator("#exp-from").fill("2026-07-01")]);
      await Promise.all([expensesLoaded(), page.locator("#exp-to").fill("2026-07-31")]);

      const rows = page.locator("tr").filter({ hasText: name });
      await expect(rows).toHaveCount(2, { timeout: 15000 });
      // Both rows listed; exactly one carries the Pending badge.
      await expect(rows.filter({ hasText: "Pending" })).toHaveCount(1, { timeout: 15000 });
      // The headline must read Rs 100 (approved only), not Rs 1,000.
      await expect(page.getByText("Rs 100", { exact: true }).first()).toBeVisible();

      await request.delete(`/api/expenses/${approved.id}`);
      await request.delete(`/api/expenses/${pending.id}`);
    } finally {
      await recorder.dispose();
      await removeRecorder(userId);
    }
  });
});
