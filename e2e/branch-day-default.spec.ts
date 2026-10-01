import "dotenv/config";
import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * A new branch's business day ends at 3am.
 *
 * It ended at midnight, which split every café open past twelve into two days — its after-midnight
 * sales landed on tomorrow in Daily Sales, the reports and the cash drawer — until the owner found
 * "Business day ends at" and changed it. Both ways a branch comes into being are checked: adding
 * one to a restaurant, and a restaurant being created. Branches that already existed are left
 * alone; moving theirs would quietly re-file their history.
 */

const THREE_AM = 180;

async function dayStartOf(branchId: string): Promise<number> {
  return withDb(async (c) =>
    (await c.query('SELECT "dayStartMinutes" FROM "BranchSettings" WHERE "branchId" = $1', [branchId])).rows[0]
      ?.dayStartMinutes as number
  );
}

test("a branch added to a restaurant ends its day at 3am", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, storageState: authFile("owner") });
  let branchId: string | undefined;
  try {
    const res = await ctx.request.post("/api/branches", { data: { name: `E2E Night ${uniqueSuffix()}` } });
    test.skip(res.status() === 403, "the demo restaurant's plan is at its branch limit");
    expect(res.ok(), await res.text()).toBeTruthy();
    branchId = (await res.json()).branch?.id ?? (await res.json()).id;
    expect(branchId).toBeTruthy();
    expect(await dayStartOf(branchId!)).toBe(THREE_AM);
  } finally {
    await ctx.close();
    if (branchId) {
      await withDb(async (c) => {
        await c.query('DELETE FROM "BranchSettings" WHERE "branchId" = $1', [branchId]);
        await c.query('DELETE FROM "Branch" WHERE id = $1', [branchId]);
      });
    }
  }
});

test("a new restaurant's first branch ends its day at 3am", async ({ baseURL }) => {
  const { ctx: admin, restore } = await platformAdmin(baseURL!);
  const slug = `e2e-night-${uniqueSuffix()}`;
  let tenantId: string | undefined;
  try {
    const res = await admin.post("/api/platform/tenants", {
      data: {
        restaurantName: "Late Night Café",
        slug,
        ownerName: "Owner",
        ownerEmail: `${slug}@example.com`,
        branchName: "Main",
        planKey: "starter",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const row = await withDb(async (c) =>
      (
        await c.query(
          'SELECT t.id AS "tenantId", b.id AS "branchId" FROM "Tenant" t JOIN "Branch" b ON b."tenantId" = t.id WHERE t.slug = $1',
          [slug]
        )
      ).rows[0]
    );
    tenantId = row.tenantId;
    expect(await dayStartOf(row.branchId)).toBe(THREE_AM);
  } finally {
    if (tenantId) await admin.delete(`/api/platform/tenants/${tenantId}`, { data: { confirmSlug: slug } });
    await restore();
  }
});
