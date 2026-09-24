import { test, expect, request as playwrightRequest } from "@playwright/test";
import { DEMO_PASSWORD, TENANT_SLUG, USERS, uniqueSuffix } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * Signing in the way people actually type on a tablet.
 *
 * The email and the restaurant code were compared exactly as typed, and an iPad keyboard
 * capitalises the first letter of a text field on its own. So "Karachi-karahi" and
 * "Waiter@karachikarahi.pk" failed a login that looked right on screen, and so did a trailing space
 * left by autocomplete. The password is the one field that must stay exact, and is tested as such.
 */

async function signIn(baseURL: string, fields: { tenantSlug: string; email: string; password: string }) {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  await ctx.post("/api/auth/callback/credentials", { form: { ...fields, csrfToken, json: "true" } });
  const session = await (await ctx.get("/api/auth/session")).json();
  await ctx.dispose();
  return session as { user?: { email?: string } } | null;
}

test.describe("Case-insensitive login", () => {
  test("capitals and stray spaces in the email and restaurant code still sign in", async ({ baseURL }) => {
    const session = await signIn(baseURL!, {
      tenantSlug: `  ${TENANT_SLUG.charAt(0).toUpperCase()}${TENANT_SLUG.slice(1).toUpperCase()} `,
      email: `  ${USERS.waiter.email.charAt(0).toUpperCase()}${USERS.waiter.email.slice(1)}  `,
      password: DEMO_PASSWORD,
    });
    expect(session?.user?.email, "the tablet-typed login should reach the real account").toBe(USERS.waiter.email);
  });

  test("the password is still exact", async ({ baseURL }) => {
    // Only the identifiers are forgiving. A password that differs by one capital is a different
    // password, and loosening that would quietly halve the work of guessing one.
    const session = await signIn(baseURL!, {
      tenantSlug: TENANT_SLUG,
      email: USERS.waiter.email,
      password: DEMO_PASSWORD.toUpperCase() === DEMO_PASSWORD ? `${DEMO_PASSWORD}x` : DEMO_PASSWORD.toUpperCase(),
    });
    expect(session?.user, "a wrong-case password must not sign in").toBeFalsy();
  });

  test("wrong guesses count against the account, not against each spelling of it", async ({ baseURL }) => {
    // The limit is 8 attempts per account per 15 minutes, keyed on the email as given. Before the
    // email was normalized, "Probe@x" and "probe@x" were different keys — so every capitalisation
    // bought a fresh 8 guesses at the same account.
    const local = `case-probe-${uniqueSuffix()}`;
    const spellings = [`${local}@Example.com`, `${local.toUpperCase()}@EXAMPLE.COM`, ` ${local}@example.com `];
    for (const email of spellings) {
      await signIn(baseURL!, { tenantSlug: TENANT_SLUG, email, password: "definitely-wrong" });
    }

    const keys = await withDb(async (c) =>
      (
        await c.query(`SELECT key, count(*)::int AS n FROM "RateLimitHit" WHERE lower(key) LIKE $1 GROUP BY key`, [
          `login:%:${local}@example.com`,
        ])
      ).rows as { key: string; n: number }[]
    );
    expect(keys, "every spelling should land on one counter").toHaveLength(1);
    expect(keys[0].n).toBe(spellings.length);
    expect(keys[0].key, "and that counter is the lowercase one").toBe(keys[0].key.toLowerCase());
  });
});
