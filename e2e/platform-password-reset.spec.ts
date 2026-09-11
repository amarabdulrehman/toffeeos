import "dotenv/config";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { TENANT_SLUG, uniqueSuffix } from "./fixtures/test-data";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * Platform-admin password reset — the answer to "a client rang, they're locked out".
 *
 * Worth testing properly rather than eyeballing, because it is the one action that hands out a
 * working credential. The three properties that matter: the temp password actually signs them in,
 * the OLD one stops working, and any session they already had dies. A reset that leaves either
 * alive is not a reset — and if the reason for the call is "someone else knows my password", it is
 * worse than doing nothing.
 *
 * Operates on a throwaway user it creates and deletes, never a seeded one. The first version reset
 * the seeded cashier and broke three later specs: revoking that account's sessions — which is the
 * feature working correctly — invalidated the stored cashier session every other cashier spec
 * reuses, so they got 401 where they assert 403. A test whose whole subject is killing sessions has
 * no business pointing at an account the rest of the suite shares.
 */
const PASSWORD = "ResetProbe!Passw0rd";

test.describe("Platform admin password reset", () => {
  let tenantId: string;
  let userId: string;
  let email: string;

  test.beforeAll(async () => {
    const suffix = uniqueSuffix();
    email = `reset-probe-${suffix}@example.com`;
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(PASSWORD, 10);

    await withDb(async (c) => {
      tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
      const branchId = (
        await c.query('SELECT id FROM "Branch" WHERE "tenantId" = $1 ORDER BY "createdAt" LIMIT 1', [tenantId])
      ).rows[0].id;
      const roleId = (
        await c.query(`SELECT id FROM "Role" WHERE "tenantId" = $1 AND key = 'cashier' LIMIT 1`, [tenantId])
      ).rows[0].id;

      userId = (
        await c.query(
          `INSERT INTO "User" (id, "tenantId", name, email, "passwordHash", "isActive")
           VALUES (gen_random_uuid(), $1, 'Reset Probe', $2, $3, true) RETURNING id`,
          [tenantId, email, hash]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO "Membership" (id, "tenantId", "userId", "branchId", "roleId", "isActive")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`,
        [tenantId, userId, branchId, roleId]
      );
    });
  });

  test.afterAll(async () => {
    await withDb(async (c) => {
      await c.query('DELETE FROM "Membership" WHERE "userId" = $1', [userId]);
      await c.query('DELETE FROM "User" WHERE id = $1', [userId]);
    });
  });

  async function signIn(baseURL: string, password: string) {
    const ctx = await playwrightRequest.newContext({ baseURL });
    const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
    await ctx.post("/api/auth/callback/credentials", {
      form: { tenantSlug: TENANT_SLUG, email, password, csrfToken, json: "true" },
    });
    const session = await (await ctx.get("/api/auth/session")).json();
    return { ctx, email: session?.user?.email ?? null };
  }

  test("issues a working temp password, kills the old one, and revokes live sessions", async ({ baseURL }) => {
    const url = baseURL!;

    // A session that exists BEFORE the reset — it must not survive it.
    const before = await signIn(url, PASSWORD);
    expect(before.email, "the probe user should be able to sign in to begin with").toBe(email);
    expect((await before.ctx.get("/api/orders")).status(), "that session should work before the reset").toBe(200);

    const admin = await platformAdmin(url);
    try {
      const res = await admin.ctx.post(`/api/platform/tenants/${tenantId}/reset-password`, { data: { userId } });
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();

      expect(body.tempPassword, "a temp password must come back").toBeTruthy();
      expect(String(body.tempPassword).length).toBeGreaterThanOrEqual(12);
      expect(body.tempPassword).not.toBe(PASSWORD);

      // 1. The old password no longer works.
      const withOld = await signIn(url, PASSWORD);
      expect(withOld.email, "the old password must stop working").toBeNull();
      await withOld.ctx.dispose();

      // 2. The temp password does.
      const withTemp = await signIn(url, body.tempPassword);
      expect(withTemp.email, "the temp password must sign them in").toBe(email);
      await withTemp.ctx.dispose();

      // 3. The session that existed before the reset is dead. This is the property a reset is
      //    actually for, and the one most likely to be missed.
      expect((await before.ctx.get("/api/orders")).status(), "the pre-reset session must be revoked").toBe(401);

      // 4. They are forced to choose their own password rather than keeping the temporary one.
      const flagged = await withDb((c) =>
        c.query('SELECT "mustChangePassword" m FROM "User" WHERE id = $1', [userId])
      );
      expect(flagged.rows[0].m, "mustChangePassword must be set").toBe(true);
    } finally {
      await before.ctx.dispose();
      await admin.restore();
    }
  });

  test("a tenant session cannot reset anyone's password", async ({ browser, baseURL }) => {
    // The route is platform-only; a restaurant owner must not be able to reach it for their own
    // tenant, let alone anyone else's.
    const ctx = await browser.newContext({ baseURL, storageState: "e2e/.auth/owner.json" });
    try {
      const res = await ctx.request.post(`/api/platform/tenants/${tenantId}/reset-password`, { data: { userId } });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.close();
    }
  });
});
