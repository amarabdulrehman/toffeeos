import "dotenv/config";
import { test, expect } from "@playwright/test";
import { authFile, TENANT_SLUG, uniqueSuffix } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * Cross-branch IDOR on the payslip route.
 *
 * GET /api/hr/payslip/[membershipId] takes the membership id straight from the URL. getPayslip
 * scopes by tenant (RLS) but not by branch, so before the guard was added a Branch Manager could
 * read the pay type, hourly rate, monthly salary, hours worked and gross pay of any employee at
 * any *other* branch in the same tenant just by changing the id.
 *
 * The seeded staff all sit at branch 1, so the "other branch" membership is created here against
 * branch 2 and torn down afterwards — the suite must not depend on a second branch happening to
 * have staff in it.
 */

interface Fixture {
  otherBranchMembershipId: string;
  ownBranchMembershipId: string;
  cleanup: () => Promise<void>;
}

async function setup(): Promise<Fixture> {
  const suffix = uniqueSuffix();
  const email = `payslip-idor-${suffix}@example.com`;

  return withDb(async (c) => {
    const tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id as string;

    // The manager's own branch, and any branch that is not it.
    const managerBranchId = (
      await c.query(
        `SELECT m."branchId" FROM "Membership" m
           JOIN "User" u ON u.id = m."userId"
          WHERE m."tenantId" = $1 AND u.email = 'manager@karachikarahi.pk' LIMIT 1`,
        [tenantId]
      )
    ).rows[0].branchId as string;

    const otherBranch = await c.query(
      'SELECT id FROM "Branch" WHERE "tenantId" = $1 AND id <> $2 LIMIT 1',
      [tenantId, managerBranchId]
    );
    if (otherBranch.rowCount === 0) {
      throw new Error("This test needs the tenant to have a second branch — reseed with `npm run seed`.");
    }
    const otherBranchId = otherBranch.rows[0].id as string;

    const managerMembershipId = (
      await c.query(
        `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
          WHERE m."tenantId" = $1 AND u.email = 'manager@karachikarahi.pk' LIMIT 1`,
        [tenantId]
      )
    ).rows[0].id as string;

    // A real employee at the other branch, with a real salary to leak.
    const roleId = (
      await c.query(`SELECT id FROM "Role" WHERE "tenantId" = $1 AND key = 'cashier' LIMIT 1`, [tenantId])
    ).rows[0].id as string;

    const userId = (
      await c.query(
        `INSERT INTO "User" (id, "tenantId", name, email, "passwordHash", "isActive")
         VALUES (gen_random_uuid(), $1, 'Other Branch Employee', $2, 'x', true) RETURNING id`,
        [tenantId, email]
      )
    ).rows[0].id as string;

    const membershipId = (
      await c.query(
        `INSERT INTO "Membership" (id, "tenantId", "userId", "branchId", "roleId", "isActive", "payType", "monthlySalaryPaisa")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true, 'MONTHLY', 9999900) RETURNING id`,
        [tenantId, userId, otherBranchId, roleId]
      )
    ).rows[0].id as string;

    return {
      otherBranchMembershipId: membershipId,
      ownBranchMembershipId: managerMembershipId,
      cleanup: async () => {
        await withDb(async (c2) => {
          await c2.query('DELETE FROM "Membership" WHERE id = $1', [membershipId]);
          await c2.query('DELETE FROM "User" WHERE id = $1', [userId]);
        });
      },
    };
  });
}

const RANGE = "from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z";

test.describe("Payslip branch isolation", () => {
  test.use({ storageState: authFile("manager") });

  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await setup();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test("a branch manager cannot read a payslip from another branch", async ({ request }) => {
    const res = await request.get(`/api/hr/payslip/${fixture.otherBranchMembershipId}?${RANGE}`);
    expect(res.status(), await res.text()).toBe(403);

    // Not just the status — the salary itself must not be in the body under any key.
    expect(await res.text()).not.toContain("9999900");
  });

  test("a branch manager can still read a payslip from their own branch", async ({ request }) => {
    // The positive control: proves the 403 above comes from the branch check and not from the
    // route being broken for this role outright. A seeded manager has no pay profile, so 400 is
    // the healthy answer here — the one thing it must not be is 403.
    const res = await request.get(`/api/hr/payslip/${fixture.ownBranchMembershipId}?${RANGE}`);
    expect(res.status(), await res.text()).not.toBe(403);
  });

  test("an owner can still read across branches", async ({ browser, baseURL }) => {
    // orders.viewAllBranches is what separates the two roles here; the owner holds it, so the same
    // request that 403s for the manager must succeed.
    const ctx = await browser.newContext({ baseURL, storageState: authFile("owner") });
    try {
      const res = await ctx.request.get(`/api/hr/payslip/${fixture.otherBranchMembershipId}?${RANGE}`);
      expect(res.status(), await res.text()).toBe(200);
    } finally {
      await ctx.close();
    }
  });
});
