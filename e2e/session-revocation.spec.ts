import { createHash } from "node:crypto";
import "dotenv/config";
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { TENANT_SLUG, DEMO_PASSWORD, authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Server-side session revocation for stateless JWT sessions.
 *
 * Sign-out used to clear the cookie and nothing else: the JWT stayed cryptographically valid until
 * it expired (30 days), so any copy of it — lifted from a shared POS terminal, still live on
 * another device — kept full access. Deactivating a staff member had the same hole, because
 * `isActive` was only ever consulted at login.
 *
 * These tests hold a real, working session and then revoke it out from under itself, which is the
 * only way to show the fix does anything: the same cookie must go from 200 to 401 with no new
 * request from the browser and no waiting for expiry.
 */

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** A throwaway staff account with a fresh email each run — reusing one address would accumulate
 * hits against the 8-per-15-minutes login rate limit. */
async function createStaff(): Promise<{ userId: string; email: string }> {
  const email = `e2e-revoke-${uniqueSuffix()}@karachikarahi.pk`;
  const userId = await withDb(async (c) => {
    const tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
    const branchId = (
      await c.query('SELECT id FROM "Branch" WHERE "tenantId" = $1 AND "isActive" ORDER BY "createdAt" LIMIT 1', [
        tenantId,
      ])
    ).rows[0].id;
    const roleId = (await c.query('SELECT id FROM "Role" WHERE "tenantId" = $1 AND key = $2', [tenantId, "owner"]))
      .rows[0].id;
    const hash = (
      await c.query('SELECT "passwordHash" FROM "User" WHERE "tenantId" = $1 AND email = $2', [
        tenantId,
        "owner@karachikarahi.pk",
      ])
    ).rows[0].passwordHash;

    await c.query('DELETE FROM "Membership" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE $1)', [
      "e2e-revoke-%",
    ]);
    await c.query('DELETE FROM "User" WHERE email LIKE $1', ["e2e-revoke-%"]);

    const u = await c.query(
      'INSERT INTO "User" (id, "tenantId", email, name, "passwordHash", "isActive") ' +
        "VALUES (gen_random_uuid(), $1, $2, 'E2E Revoke', $3, true) RETURNING id",
      [tenantId, email, hash]
    );
    await c.query(
      'INSERT INTO "Membership" (id, "tenantId", "userId", "branchId", "roleId", grants, denies, "isActive") ' +
        "VALUES (gen_random_uuid(), $1, $2, $3, $4, '{}', '{}', true)",
      [tenantId, u.rows[0].id, branchId, roleId]
    );
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

/** Any route behind defineHandler. 200 = session alive, 401 = revoked. */
const PROBE = "/api/expense-categories";

test.describe("Session revocation", () => {
  // The third test compares against the suite's own owner session.
  test.use({ storageState: authFile("owner") });

  test("bumping sessionsValidFrom kills an already-issued session on its next request", async ({ baseURL }) => {
    const { userId, email } = await createStaff();
    const ctx = await login(baseURL!, email);

    try {
      // The session works.
      expect((await ctx.get(PROBE)).status(), "a fresh session should be accepted").toBe(200);

      // Revoke it server-side — exactly what signing out now does.
      await withDb((c) =>
        c.query('UPDATE "User" SET "sessionsValidFrom" = now() WHERE id = $1', [userId])
      );

      // Same cookie, no new request from the client, no waiting for expiry.
      const after = await ctx.get(PROBE);
      expect(after.status(), "the same cookie must now be rejected").toBe(401);
      expect((await after.json()).error).toMatch(/signed out/i);
    } finally {
      await ctx.dispose();
      await removeStaff(userId);
    }
  });

  test("deactivating a staff member revokes their live session immediately", async ({ baseURL }) => {
    const { userId, email } = await createStaff();
    const ctx = await login(baseURL!, email);

    try {
      expect((await ctx.get(PROBE)).status()).toBe(200);

      // The "someone was fired mid-shift" case. Previously this took up to 30 days to bite.
      await withDb((c) => c.query('UPDATE "User" SET "isActive" = false WHERE id = $1', [userId]));

      const after = await ctx.get(PROBE);
      expect(after.status(), "a deactivated account must lose access at once").toBe(401);
      expect((await after.json()).error).toMatch(/no longer active/i);
    } finally {
      await ctx.dispose();
      await removeStaff(userId);
    }
  });

  test("revocation is scoped to the account — other users are unaffected", async ({ baseURL, request }) => {
    const { userId, email } = await createStaff();
    const ctx = await login(baseURL!, email);

    try {
      expect((await ctx.get(PROBE)).status()).toBe(200);
      await withDb((c) => c.query('UPDATE "User" SET "sessionsValidFrom" = now() WHERE id = $1', [userId]));
      expect((await ctx.get(PROBE)).status()).toBe(401);

      // The suite's own owner session, revoked at the same moment, must still be fine.
      expect((await request.get(PROBE)).status(), "revoking one user must not sign out everyone").toBe(200);
    } finally {
      await ctx.dispose();
      await removeStaff(userId);
    }
  });

  test("a password reset signs out every existing session", async ({ baseURL }) => {
    // The reset flow is often used *because* someone else may have the account, so an attacker
    // holding a live JWT must not survive the victim resetting their password.
    const { userId, email } = await createStaff();
    const ctx = await login(baseURL!, email);

    try {
      expect((await ctx.get(PROBE)).status()).toBe(200);

      // Drive the real reset: issue a token, then consume it exactly as the reset page does.
      const token = await withDb(async (c) => {
        const tenantId = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
        // `token` is the primary key and Prisma generates it in application code, so raw SQL has to
        // supply one — there is no database-level default to fall back on. What the column holds is
        // a SHA-256 of the token (src/server/password-reset.ts), so plant the digest and post the
        // plaintext, the way a real reset link works.
        const plaintext = `revocation-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await c.query(
          'INSERT INTO "PasswordResetToken" (token, "userType", "userId", "tenantId", "expiresAt") ' +
            "VALUES ($1, 'tenant', $2, $3, now() + interval '30 minutes')",
          [createHash("sha256").update(plaintext).digest("hex"), userId, tenantId]
        );
        return plaintext;
      });

      const anon = await playwrightRequest.newContext({ baseURL, storageState: undefined });
      const res = await anon.post("/api/auth/reset-password", {
        data: { token, newPassword: "Brand!NewPassw0rd" },
      });
      // Read the body before disposing the context — disposal invalidates the response object.
      const ok = res.ok();
      const status = res.status();
      const body = await res.text();
      await anon.dispose();
      // /api/auth/reset-password allows 10 attempts per 15 minutes per IP. Re-running this spec a
      // few times in a row hits that, and a rate-limited run used to report as a failed assertion
      // about session revocation — a red result that says nothing about the behaviour under test.
      test.skip(status === 429, "reset-confirm rate limit reached — re-run once the window clears");
      expect(ok, body).toBeTruthy();

      const after = await ctx.get(PROBE);
      expect(after.status(), "the pre-reset session must be dead").toBe(401);
    } finally {
      await ctx.dispose();
      await removeStaff(userId);
    }
  });

  test("a deactivated user cannot even load the app shell", async ({ baseURL, browser }) => {
    // The API refusing every call is not enough on its own: the page shell used to render in full
    // for a revoked session, so the person saw a working app whose every action failed.
    const { userId, email } = await createStaff();
    const ctx = await login(baseURL!, email);
    const state = await ctx.storageState();
    await ctx.dispose();

    const page = await (await browser.newContext({ baseURL, storageState: state })).newPage();
    try {
      await page.goto("/app/dashboard");
      await expect(page).toHaveURL(/\/app\/dashboard/);

      await withDb((c) => c.query('UPDATE "User" SET "isActive" = false WHERE id = $1', [userId]));

      await page.goto("/app/dashboard");
      await expect(page, "a revoked session must be bounced to login, not shown the app").toHaveURL(/\/login/);
    } finally {
      await page.close();
      await removeStaff(userId);
    }
  });
});
