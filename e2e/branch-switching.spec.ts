import "dotenv/config";
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { TENANT_SLUG, DEMO_PASSWORD, authFile, uniqueSuffix } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * Working in more than one branch, and adding one.
 *
 * Three things were missing, and together they meant an owner could not run a second branch:
 * - Nobody could switch branch. Sign-in always opened a person's first branch, and the session's
 *   branch decides where settings, tax rates, orders and the till all go.
 * - A new branch had no members, so not even the owner who made it could open it.
 * - A new branch had no tax rates, so it charged 0% from its first sale.
 *
 * The switch rebuilds the session server-side for a membership the person really holds. Because
 * that rebuild re-stamps the token, it must also refuse a session that was already signed out, or a
 * stolen cookie could revive itself; that is checked here too.
 */

interface Branch {
  id: string;
  name: string;
  isActive: boolean;
}

/** A throwaway account with a fresh email each run, in the branches given, with that role. */
async function createStaff(branchIds: string[], roleKey = "owner"): Promise<{ userId: string; email: string }> {
  const email = `e2e-branch-${uniqueSuffix()}@karachikarahi.pk`;
  const userId = await withDb(async (c) => {
    const tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
    const roleId = (await c.query('SELECT id FROM "Role" WHERE "tenantId" = $1 AND key = $2', [tenantId, roleKey])).rows[0].id;
    const hash = (
      await c.query('SELECT "passwordHash" FROM "User" WHERE "tenantId" = $1 AND email = $2', [tenantId, "owner@karachikarahi.pk"])
    ).rows[0].passwordHash;
    const u = await c.query(
      'INSERT INTO "User" (id, "tenantId", email, name, "passwordHash", "isActive") ' +
        "VALUES (gen_random_uuid(), $1, $2, 'E2E Branch', $3, true) RETURNING id",
      [tenantId, email, hash]
    );
    for (const branchId of branchIds) {
      await c.query(
        'INSERT INTO "Membership" (id, "tenantId", "userId", "branchId", "roleId", grants, denies, "isActive") ' +
          "VALUES (gen_random_uuid(), $1, $2, $3, $4, '{}', '{}', true)",
        [tenantId, u.rows[0].id, branchId, roleId]
      );
    }
    return u.rows[0].id as string;
  });
  return { userId, email };
}

async function removeStaff(userId: string) {
  await withDb(async (c) => {
    await c.query('DELETE FROM "Membership" WHERE "userId" = $1', [userId]);
    await c.query('DELETE FROM "User" WHERE id = $1', [userId]);
  });
}

async function login(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: undefined });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  await ctx.post("/api/auth/callback/credentials", {
    form: { tenantSlug: TENANT_SLUG, email, password: DEMO_PASSWORD, csrfToken, json: "true" },
  });
  return ctx;
}

/** What the browser's useSession().update({ branchId }) sends. */
async function requestSwitch(ctx: APIRequestContext, branchId: string) {
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  await ctx.post("/api/auth/session", { data: { csrfToken, data: { branchId } } });
}

async function sessionBranchId(ctx: APIRequestContext): Promise<string | undefined> {
  return (await (await ctx.get("/api/auth/session")).json())?.user?.branchId;
}

async function demoBranches(baseURL: string): Promise<Branch[]> {
  const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
  const { branches } = (await (await owner.get("/api/branches")).json()) as { branches: Branch[] };
  await owner.dispose();
  return branches.filter((b) => b.isActive);
}

/** Any route behind defineHandler. 200 = session alive, 401 = revoked. */
const PROBE = "/api/expense-categories";

test.describe("Branch switching", () => {
  test("someone in two branches can switch between them from the sidebar", async ({ browser, baseURL }) => {
    const branches = await demoBranches(baseURL!);
    test.skip(branches.length < 2, "demo tenant needs two active branches");
    const [first, second] = branches;
    const { userId, email } = await createStaff([first.id, second.id]);
    const api = await login(baseURL!, email);
    const context = await browser.newContext({ storageState: await api.storageState() });
    const page = await context.newPage();
    try {
      await page.goto("/app/dashboard");
      const select = page.locator("aside").getByRole("combobox", { name: "Switch branch" });
      await expect(select).toHaveValue(first.id);

      await select.selectOption(second.id);
      await expect(page.locator("main").getByText(`· ${second.name}`).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("aside").getByRole("combobox", { name: "Switch branch" })).toHaveValue(second.id);
      expect(await sessionBranchId(context.request), "the session itself moved").toBe(second.id);
    } finally {
      await context.close();
      await api.dispose();
      await removeStaff(userId);
    }
  });

  test("a manager of one branch sees no switcher and cannot switch to another", async ({ browser, baseURL }) => {
    const branches = await demoBranches(baseURL!);
    test.skip(branches.length < 2, "demo tenant needs two active branches");
    const [first, second] = branches;
    const { userId, email } = await createStaff([first.id], "branch_manager");
    const api = await login(baseURL!, email);
    const context = await browser.newContext({ storageState: await api.storageState() });
    const page = await context.newPage();
    try {
      await page.goto("/app/dashboard");
      await expect(page.locator("aside").getByText(first.name)).toBeVisible();
      await expect(page.locator("aside").getByRole("combobox", { name: "Switch branch" })).toHaveCount(0);

      // Forging the request is no better: there is no membership to rebuild the session from.
      await requestSwitch(api, second.id);
      expect(await sessionBranchId(api)).toBe(first.id);
    } finally {
      await context.close();
      await api.dispose();
      await removeStaff(userId);
    }
  });

  test("an owner can open a branch they were never added to", async ({ browser, baseURL }) => {
    /**
     * Branches made before new ones took their owners along have no owner membership, and an owner
     * can't be invited to one (an invite makes a new account). Owners see every branch in the
     * switcher, and switching to one joins it.
     */
    const branches = await demoBranches(baseURL!);
    test.skip(branches.length < 2, "demo tenant needs two active branches");
    const [first, second] = branches;
    const { userId, email } = await createStaff([first.id]);
    const api = await login(baseURL!, email);
    const context = await browser.newContext({ storageState: await api.storageState() });
    const page = await context.newPage();
    try {
      await page.goto("/app/dashboard");
      const select = page.locator("aside").getByRole("combobox", { name: "Switch branch" });
      await expect(select.locator("option")).toHaveCount(branches.length);
      await select.selectOption(second.id);
      await expect(page.locator("main").getByText(`· ${second.name}`).first()).toBeVisible({ timeout: 30_000 });
      expect(await sessionBranchId(context.request)).toBe(second.id);

      const joined = await withDb(async (c) =>
        (
          await c.query(
            'SELECT r.key FROM "Membership" m JOIN "Role" r ON r.id = m."roleId" WHERE m."userId" = $1 AND m."branchId" = $2 AND m."isActive"',
            [userId, second.id]
          )
        ).rows
      );
      expect(joined, "joined as owner").toEqual([{ key: "owner" }]);
    } finally {
      await context.close();
      await api.dispose();
      await removeStaff(userId);
    }
  });

  test("a signed-out session cannot bring itself back by switching branch", async ({ baseURL }) => {
    const branches = await demoBranches(baseURL!);
    test.skip(branches.length < 2, "demo tenant needs two active branches");
    const [first, second] = branches;
    const { userId, email } = await createStaff([first.id, second.id]);
    const api = await login(baseURL!, email);
    try {
      expect((await api.get(PROBE)).status()).toBe(200);
      await withDb((c) => c.query('UPDATE "User" SET "sessionsValidFrom" = now() WHERE id = $1', [userId]));
      expect((await api.get(PROBE)).status(), "revoked").toBe(401);

      // The switch rebuilds the token, and the rebuild used to re-stamp it as if freshly issued.
      await requestSwitch(api, second.id);
      expect((await api.get(PROBE)).status(), "still revoked after asking to switch").toBe(401);
    } finally {
      await api.dispose();
      await removeStaff(userId);
    }
  });
});

test.describe("Adding a branch", () => {
  test.use({ storageState: authFile("owner") });

  test("a new branch gets the restaurant's tax rates, a stock location and its owner", async ({ request }) => {
    const me = (await (await request.get("/api/auth/session")).json()).user as { id: string; branchId: string };
    const res = await request.post("/api/branches", { data: { name: `E2E Second ${uniqueSuffix()}` } });
    test.skip(res.status() === 403, "the demo restaurant's plan is at its branch limit");
    expect(res.ok(), await res.text()).toBeTruthy();
    const branchId: string = (await res.json()).branch.id;

    try {
      const rows = await withDb(async (c) => {
        const rates = async (id: string) =>
          (
            await c.query(
              'SELECT name, "rateBasisPoints", "paymentMethods"::text[] AS methods FROM "TaxRule" WHERE "branchId" = $1 AND "isActive" AND "effectiveTo" IS NULL ORDER BY name',
              [id]
            )
          ).rows;
        // The rates come from the restaurant's oldest branch with any.
        const sourceId = (
          await c.query(
            `SELECT b.id FROM "Branch" b WHERE b."tenantId" = (SELECT "tenantId" FROM "Branch" WHERE id = $1) AND b.id <> $1
               AND EXISTS (SELECT 1 FROM "TaxRule" t WHERE t."branchId" = b.id AND t."isActive") ORDER BY b."createdAt" LIMIT 1`,
            [branchId]
          )
        ).rows[0]?.id;
        return {
          source: sourceId ? await rates(sourceId) : [],
          copied: await rates(branchId),
          defaultLocation: (
            await c.query(
              'SELECT s."defaultStockLocationId", l."branchId" FROM "BranchSettings" s LEFT JOIN "StockLocation" l ON l.id = s."defaultStockLocationId" WHERE s."branchId" = $1',
              [branchId]
            )
          ).rows[0],
          ownerMember: (
            await c.query('SELECT 1 FROM "Membership" WHERE "branchId" = $1 AND "userId" = $2 AND "isActive"', [branchId, me.id])
          ).rowCount,
        };
      });

      expect(rows.copied.length, "a new branch must not start at 0% tax").toBeGreaterThan(0);
      if (rows.source.length > 0) expect(rows.copied).toEqual(rows.source);
      expect(rows.defaultLocation?.branchId, "stock has somewhere to come from").toBe(branchId);
      expect(rows.ownerMember, "the owner who made it can open it").toBe(1);
    } finally {
      await withDb(async (c) => {
        await c.query('UPDATE "BranchSettings" SET "defaultStockLocationId" = NULL WHERE "branchId" = $1', [branchId]);
        await c.query('DELETE FROM "StockLocation" WHERE "branchId" = $1', [branchId]);
        await c.query('DELETE FROM "TaxRule" WHERE "branchId" = $1', [branchId]);
        await c.query('DELETE FROM "Membership" WHERE "branchId" = $1', [branchId]);
        await c.query('DELETE FROM "BranchSettings" WHERE "branchId" = $1', [branchId]);
        await c.query('DELETE FROM "Branch" WHERE id = $1', [branchId]);
      });
    }
  });
});
