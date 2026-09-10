import "dotenv/config";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { TENANT_SLUG, DEMO_PASSWORD, USERS } from "./fixtures/test-data";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * Platform-admin password reset — the answer to "a client rang, they're locked out".
 *
 * Worth testing properly rather than eyeballing, because it is the one action that hands out a
 * working credential. The three properties that matter: the temp password actually signs them in,
 * the OLD one stops working, and any session they already had dies. A reset that leaves the old
 * password or the old session alive is not a reset — and if the reason for the call is "someone
 * else knows my password", it is worse than doing nothing.
 *
 * Resets the cashier (not the owner) so the other specs' owner session is unaffected, and puts the
 * seeded password back afterwards so the suite is order-independent.
 *
 * Known interaction, not a bug: tenant login is rate-limited to 8 attempts per 15 minutes per
 * account (`login:<tenantId>:<email>` in src/server/auth/config.ts). This spec spends three of the
 * cashier's on purpose — the pre-reset sign-in, the old-password-must-fail check, and the
 * temp-password sign-in — and global-setup spends another whenever the stored session has gone
 * stale, which a password reset guarantees. Re-running this file two or three times inside a
 * quarter-hour will therefore start failing in global-setup with "Login for cashier did not produce
 * a valid session", which looks alarming and means only that the budget is spent. Wait it out; the
 * same shape of interaction is documented in tenant-isolation.spec.ts for the signup limit.
 */
test.describe("Platform admin password reset", () => {
  let tenantId: string;
  let cashierUserId: string;

  test.beforeAll(async () => {
    await withDb(async (c) => {
      tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
      cashierUserId = (
        await c.query('SELECT id FROM "User" WHERE "tenantId" = $1 AND email = $2', [tenantId, USERS.cashier.email])
      ).rows[0].id;
    });
  });

  test.afterAll(async () => {
    // Put the seeded password back so the rest of the suite is unaffected by run order.
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await withDb((c) =>
      c.query('UPDATE "User" SET "passwordHash" = $1, "mustChangePassword" = false WHERE id = $2', [hash, cashierUserId])
    );
  });

  async function signIn(baseURL: string, password: string) {
    const ctx = await playwrightRequest.newContext({ baseURL });
    const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
    await ctx.post("/api/auth/callback/credentials", {
      form: { tenantSlug: TENANT_SLUG, email: USERS.cashier.email, password, csrfToken, json: "true" },
    });
    const session = await (await ctx.get("/api/auth/session")).json();
    return { ctx, email: session?.user?.email ?? null };
  }

  test("issues a working temp password, kills the old one, and revokes live sessions", async ({ baseURL }) => {
    const url = baseURL!;

    // A session that exists BEFORE the reset — it must not survive it.
    const before = await signIn(url, DEMO_PASSWORD);
    expect(before.email, "the cashier should be able to sign in to begin with").toBe(USERS.cashier.email);
    const liveBefore = await before.ctx.get("/api/orders");
    expect(liveBefore.status(), "that session should work before the reset").toBe(200);

    const admin = await platformAdmin(url);
    try {
      const res = await admin.ctx.post(`/api/platform/tenants/${tenantId}/reset-password`, {
        data: { userId: cashierUserId },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();

      expect(body.tempPassword, "a temp password must come back").toBeTruthy();
      expect(String(body.tempPassword).length).toBeGreaterThanOrEqual(12);
      expect(body.tempPassword).not.toBe(DEMO_PASSWORD);

      // 1. The old password no longer works.
      const withOld = await signIn(url, DEMO_PASSWORD);
      expect(withOld.email, "the old password must stop working").toBeNull();
      await withOld.ctx.dispose();

      // 2. The temp password does.
      const withTemp = await signIn(url, body.tempPassword);
      expect(withTemp.email, "the temp password must sign them in").toBe(USERS.cashier.email);
      await withTemp.ctx.dispose();

      // 3. The session that existed before the reset is dead. This is the property a reset is
      //    actually for, and the one most likely to be missed.
      const liveAfter = await before.ctx.get("/api/orders");
      expect(liveAfter.status(), "the pre-reset session must be revoked").toBe(401);

      // 4. They are forced to choose their own password rather than keeping the temporary one.
      const flagged = await withDb((c) =>
        c.query('SELECT "mustChangePassword" m FROM "User" WHERE id = $1', [cashierUserId])
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
      const res = await ctx.request.post(`/api/platform/tenants/${tenantId}/reset-password`, {
        data: { userId: cashierUserId },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.close();
    }
  });
});
