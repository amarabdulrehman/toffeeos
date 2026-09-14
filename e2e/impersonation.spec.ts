import { test, expect, request as playwrightRequest } from "@playwright/test";
import { authFile, TENANT_SLUG, uniqueSuffix } from "./fixtures/test-data";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * Platform-admin impersonation.
 *
 * This had no coverage of any kind, and it is the most powerful action in the product: one POST
 * and a platform admin is inside a paying client's account, seeing their live sales, staff and
 * customers. If any part of it is wrong — the route reachable by a tenant, the hand-off token
 * reusable, an expired token still accepted — the failure is a stranger in a client's books.
 *
 * The hand-off is a 60-second single-use token: POST /api/platform/tenants/[id]/impersonate mints
 * it, the browser hands it to signIn("impersonate", {token}), and consuming it deletes it. The
 * point of the token is to keep a raw userId out of a URL; it is not meant to be a standing
 * credential, and this pins that it cannot become one.
 */

async function signInWithToken(baseURL: string, token: string) {
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: undefined });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  await ctx.post("/api/auth/callback/impersonate", { form: { token, csrfToken, json: "true" } });
  const session = await (await ctx.get("/api/auth/session")).json();
  await ctx.dispose();
  return session;
}

test.describe("Platform impersonation — a tenant cannot start one", () => {
  // A real, signed-in tenant owner. Running this anonymously would pass on the absence of any
  // session at all and prove nothing about whether a *tenant* is kept out.
  test.use({ storageState: authFile("owner") });

  test("a tenant session cannot mint an impersonation token", async ({ request }) => {
    const session = await (await request.get("/api/auth/session")).json();
    expect(session?.user, "this test is meaningless without a live tenant session").toBeTruthy();

    const tenantId = session.user.tenantId;
    const res = await request.post(`/api/platform/tenants/${tenantId}/impersonate`, { data: {} });
    expect([401, 403, 404], `a tenant reached a platform route (${res.status()})`).toContain(res.status());
  });
});

test.describe("Platform impersonation", () => {
  test("the hand-off token signs in as the tenant's owner, once, and is audit-logged", async ({ baseURL }) => {
    const admin = await platformAdmin(baseURL!);
    try {
      const tenantId = await withDb((c) =>
        c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG]).then((r) => r.rows[0].id)
      );

      const before = await withDb((c) =>
        c
          .query(`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'platform.impersonate' AND "entityId" = $1`, [
            tenantId,
          ])
          .then((r) => r.rows[0].n)
      );

      const minted = await admin.ctx.post(`/api/platform/tenants/${tenantId}/impersonate`, { data: {} });
      expect(minted.ok(), await minted.text()).toBeTruthy();
      const { token } = await minted.json();
      expect(token, "the route should return a hand-off token").toBeTruthy();

      // Minting is audit-logged before the admin even follows through, so an abandoned
      // impersonation still leaves a trace.
      const after = await withDb((c) =>
        c
          .query(`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'platform.impersonate' AND "entityId" = $1`, [
            tenantId,
          ])
          .then((r) => r.rows[0].n)
      );
      expect(after, "minting a token must be audit-logged").toBe(before + 1);

      const session = await signInWithToken(baseURL!, token);
      expect(session?.user, "the token should produce a session").toBeTruthy();
      expect(session.user.tenantId).toBe(tenantId);
      expect(
        session.user.impersonatedByPlatformUserId,
        "the session must be marked as impersonated, not pass as the owner themselves"
      ).toBeTruthy();

      // Single use. A token that still worked on a second presentation would be a standing key to
      // a client's account sitting in whatever log or history captured the first one.
      const replay = await signInWithToken(baseURL!, token);
      expect(replay?.user, "a spent impersonation token must not sign anyone in").toBeFalsy();
    } finally {
      await admin.restore();
    }
  });

  test("an expired token is refused", async ({ baseURL }) => {
    const token = `imp-expired-${uniqueSuffix()}`;
    const { tenantId, userId } = await withDb(async (c) => {
      const t = (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id;
      const u = (await c.query('SELECT "userId" FROM "Membership" WHERE "tenantId" = $1 LIMIT 1', [t])).rows[0].userId;
      await c.query(
        `INSERT INTO "ImpersonationToken" (token, "tenantId", "targetUserId", "platformUserId", "platformUserEmail", "expiresAt")
         VALUES ($1, $2, $3, gen_random_uuid()::text, 'expired-probe@example.com', now() - interval '1 minute')`,
        [token, t, u]
      );
      return { tenantId: t, userId: u };
    });
    expect(tenantId && userId).toBeTruthy();

    const session = await signInWithToken(baseURL!, token);
    expect(session?.user, "an expired impersonation token must not sign anyone in").toBeFalsy();

    // Presenting it must also have consumed it, so a stale row cannot sit around being retried.
    const left = await withDb((c) =>
      c.query('SELECT count(*)::int n FROM "ImpersonationToken" WHERE token = $1', [token]).then((r) => r.rows[0].n)
    );
    expect(left, "an expired token should be consumed on presentation, not left behind").toBe(0);
  });
});
