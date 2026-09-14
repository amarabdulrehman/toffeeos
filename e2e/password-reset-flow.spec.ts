import "dotenv/config";
import { createHash } from "node:crypto";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { TENANT_SLUG, uniqueSuffix } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * Self-serve password reset — the token half.
 *
 * There was no coverage of this at all. platform-password-reset.spec.ts covers the *admin*-issued
 * reset, which is a different path: an admin sets a temporary password directly. Nothing exercised
 * the link a locked-out user actually clicks, which is the one flow in the product that hands an
 * anonymous caller a working credential. "Nobody has ever tested the password reset link" is not a
 * sentence that should be true of software being sold.
 *
 * The properties that matter, and what each one is guarding against:
 *   - the link works, and the new password really signs in (otherwise the feature is decorative);
 *   - the old password stops working;
 *   - the link is single-use, so a copy of it — from a forwarded email, a proxy log, a backup —
 *     cannot be replayed;
 *   - an expired link is refused;
 *   - the token is NOT stored in the database in usable form.
 *
 * Operates on a throwaway user it creates and deletes. platform-password-reset.spec.ts learned the
 * hard way that resetting a seeded account revokes the sessions every other spec shares.
 */

const OLD_PASSWORD = "SelfServeOld!Passw0rd";
const NEW_PASSWORD = "SelfServeNew!Passw0rd";

/** Mirrors src/server/password-reset.ts: the row holds a SHA-256 of the token, not the token. */
const fingerprint = (token: string) => createHash("sha256").update(token).digest("hex");

async function login(baseURL: string, email: string, password: string): Promise<boolean> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  await ctx.post("/api/auth/callback/credentials", {
    form: { tenantSlug: TENANT_SLUG, email, password, csrfToken, json: "true" },
  });
  const session = await (await ctx.get("/api/auth/session")).json();
  await ctx.dispose();
  return Boolean(session?.user);
}

test.describe("Self-serve password reset", () => {
  let tenantId: string;
  let userId: string;
  let email: string;

  test.beforeAll(async () => {
    email = `selfserve-reset-${uniqueSuffix()}@example.com`;
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(OLD_PASSWORD, 10);

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
           VALUES (gen_random_uuid(), $1, 'Self Serve Reset Probe', $2, $3, true) RETURNING id`,
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
      await c.query('DELETE FROM "PasswordResetToken" WHERE "userId" = $1', [userId]);
      await c.query('DELETE FROM "Membership" WHERE "userId" = $1', [userId]);
      await c.query('DELETE FROM "User" WHERE id = $1', [userId]);
    });
  });

  test("requesting a reset stores a fingerprint, not a usable token", async ({ request }) => {
    const res = await request.post("/api/auth/request-password-reset", {
      data: { tenantSlug: TENANT_SLUG, email },
    });
    test.skip(res.status() === 429, "reset-request rate limit reached — re-run once the window clears");
    expect(res.ok(), await res.text()).toBeTruthy();

    const rows = await withDb((c) =>
      c.query('SELECT token FROM "PasswordResetToken" WHERE "userId" = $1', [userId]).then((r) => r.rows)
    );
    expect(rows.length, "a reset request should have issued exactly one token").toBe(1);

    // The stored value must be a SHA-256 hex digest. If it were the live token, every row in this
    // table — and every nightly backup, which dumps this table — would be a working credential.
    expect(rows[0].token, "the stored token must be a 64-char hex digest, not the token itself").toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  test("the link works once, revokes the old password, and cannot be replayed", async ({ request, baseURL }) => {
    // Plant a token the test knows the plaintext of. The issuing path is covered above; this covers
    // consumption, and consumption is the half that can hand out an account.
    const token = `e2e-reset-${uniqueSuffix()}`;
    await withDb((c) =>
      c.query(
        `INSERT INTO "PasswordResetToken" (token, "userType", "userId", "tenantId", "expiresAt")
         VALUES ($1, 'tenant', $2, $3, now() + interval '30 minutes')`,
        [fingerprint(token), userId, tenantId]
      )
    );

    expect(await login(baseURL!, email, OLD_PASSWORD), "the old password should work before the reset").toBe(true);

    const used = await request.post("/api/auth/reset-password", { data: { token, newPassword: NEW_PASSWORD } });
    test.skip(used.status() === 429, "reset-confirm rate limit reached — re-run once the window clears");
    expect(used.ok(), await used.text()).toBeTruthy();

    expect(await login(baseURL!, email, NEW_PASSWORD), "the new password must sign in").toBe(true);
    expect(await login(baseURL!, email, OLD_PASSWORD), "the old password must stop working").toBe(false);

    // Replay. A reset link reaches the user by email and survives in mailboxes, forwarded threads
    // and proxy logs; if it still worked the second time, anyone who later read it would own the
    // account. This is also the race: the claim is a single conditional write, so the second
    // caller finds nothing to claim.
    const replay = await request.post("/api/auth/reset-password", {
      data: { token, newPassword: "ReplayAttempt!Passw0rd" },
    });
    expect(replay.status(), "a spent reset link must be refused").toBe(400);
    expect(await login(baseURL!, email, "ReplayAttempt!Passw0rd"), "the replay must not have changed anything").toBe(
      false
    );
    expect(await login(baseURL!, email, NEW_PASSWORD), "and the real password must still work").toBe(true);
  });

  test("an expired link is refused", async ({ request }) => {
    const token = `e2e-expired-${uniqueSuffix()}`;
    await withDb((c) =>
      c.query(
        `INSERT INTO "PasswordResetToken" (token, "userType", "userId", "tenantId", "expiresAt")
         VALUES ($1, 'tenant', $2, $3, now() - interval '1 minute')`,
        [fingerprint(token), userId, tenantId]
      )
    );

    const res = await request.post("/api/auth/reset-password", {
      data: { token, newPassword: "ExpiredAttempt!Passw0rd" },
    });
    test.skip(res.status() === 429, "reset-confirm rate limit reached — re-run once the window clears");
    expect(res.status(), "an expired reset link must be refused").toBe(400);
  });
});
