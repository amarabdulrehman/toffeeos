import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { TENANT_SLUG, uniqueSuffix } from "./fixtures/test-data";
import { platformAdmin, withDb } from "./fixtures/platform-admin";
import { TENANT_OWNED_TABLES } from "../src/lib/tenant-tables";

/**
 * Permanent tenant deletion from the platform admin panel.
 *
 * The schema has no `onDelete: Cascade` anywhere, so deletion is a hand-ordered sweep across every
 * table carrying a tenantId. That makes two things worth proving rather than assuming: that the
 * sweep actually empties all of them, and that the hand-maintained table list has not drifted from
 * the database.
 */

/**
 * Creates a throwaway tenant to erase, through the platform admin's own create route.
 *
 * Not the public /api/signup: that is capped at 3 per hour per IP, and the suite already spends
 * that budget on tenant-isolation and enumeration, so a fourth signup starved one of them. Using
 * the admin route is both unlimited and the truer path — creating and removing a restaurant from
 * the same panel is exactly what this feature is for.
 */
async function createDisposableTenant(admin: APIRequestContext) {
  const slug = `deltest-${uniqueSuffix()}`;
  const res = await admin.post("/api/platform/tenants", {
    data: {
      restaurantName: "Delete Me Diner",
      slug,
      ownerName: "Owner",
      ownerEmail: `${slug}@example.com`,
      branchName: "Main",
      planKey: "growth",
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const id = await withDb(async (c) =>
    (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [slug])).rows[0]?.id as string
  );
  expect(id, "the tenant should exist after the admin create call").toBeTruthy();
  return { id, slug };
}

test.describe("Tenant deletion", () => {
  test("the table list covers every tenant-scoped table in the database", async () => {
    // The whole operation is only correct if this list is complete. A table added later without
    // being listed here would silently orphan its rows, so this fails loudly instead.
    const inDb = await withDb(async (c) =>
      (
        await c.query(
          `SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'tenantId'`
        )
      ).rows.map((r) => r.table_name as string)
    );

    const listed = new Set<string>(TENANT_OWNED_TABLES);
    const missing = inDb.filter((t) => !listed.has(t));
    expect(missing, `these tables carry tenantId but are not deleted: ${missing.join(", ")}`).toEqual([]);

    // And nothing listed that no longer exists, which would throw mid-transaction.
    const stale = [...listed].filter((t) => !inDb.includes(t));
    expect(stale, `these are listed but no longer carry tenantId: ${stale.join(", ")}`).toEqual([]);
  });

  test("deleting a restaurant erases it and leaves no orphaned rows anywhere", async ({ baseURL }) => {
    const { ctx: admin, restore } = await platformAdmin(baseURL!);
    try {
      const victim = await createDisposableTenant(admin);

      // It really exists first, with real rows behind it.
      const before = await withDb(async (c) =>
        (await c.query('SELECT count(*)::int n FROM "User" WHERE "tenantId" = $1', [victim.id])).rows[0].n
      );
      expect(before).toBeGreaterThan(0);

      const res = await admin.delete(`/api/platform/tenants/${victim.id}`, {
        data: { confirmSlug: victim.slug },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await res.json();
      expect(body.slug).toBe(victim.slug);
      expect(body.rowsDeleted).toBeGreaterThan(0);

      // The tenant is gone...
      const tenantGone = await withDb(async (c) =>
        (await c.query('SELECT count(*)::int n FROM "Tenant" WHERE id = $1', [victim.id])).rows[0].n
      );
      expect(tenantGone).toBe(0);

      // ...and so is every row that pointed at it, in every table. This is the assertion that
      // actually matters: one missed table means data for a restaurant that no longer exists.
      const leftovers = await withDb(async (c) => {
        const found: string[] = [];
        for (const table of TENANT_OWNED_TABLES) {
          const r = await c.query(`SELECT count(*)::int n FROM "${table}" WHERE "tenantId" = $1`, [victim.id]);
          if (r.rows[0].n > 0) found.push(`${table}(${r.rows[0].n})`);
        }
        return found;
      });
      expect(leftovers, `orphaned rows left behind: ${leftovers.join(", ")}`).toEqual([]);

      // The deletion is recorded where it can outlive its subject.
      const audit = await withDb(async (c) =>
        (
          await c.query(
            `SELECT count(*)::int n FROM "AuditLog"
              WHERE action = 'platform.tenant.delete' AND "entityId" = $1 AND "tenantId" IS NULL`,
            [victim.id]
          )
        ).rows[0].n
      );
      expect(audit, "the audit entry must survive the tenant it describes").toBe(1);
    } finally {
      await restore();
    }
  });

  test("a wrong confirmation slug refuses, and the demo tenant survives it", async ({ baseURL }) => {
    const demoId = await withDb(async (c) =>
      (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id
    );
    const { ctx: admin, restore } = await platformAdmin(baseURL!);
    try {
      const res = await admin.delete(`/api/platform/tenants/${demoId}`, {
        data: { confirmSlug: "not-the-right-slug" },
      });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toContain(TENANT_SLUG);

      // Still very much alive.
      const alive = await withDb(async (c) =>
        (await c.query('SELECT count(*)::int n FROM "Tenant" WHERE id = $1', [demoId])).rows[0].n
      );
      expect(alive, "a mistyped confirmation must never delete anything").toBe(1);
    } finally {
      await restore();
    }
  });

  test("a tenant owner cannot delete their own or anyone else's restaurant", async ({ request }) => {
    const demoId = await withDb(async (c) =>
      (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id
    );
    // The suite's owner session is a tenant session; platform routes must refuse it outright.
    const res = await request.delete(`/api/platform/tenants/${demoId}`, {
      data: { confirmSlug: TENANT_SLUG },
    });
    expect(res.status()).toBe(401);
  });
});
