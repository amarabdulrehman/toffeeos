import { test, expect, request as playwrightRequest } from "@playwright/test";
import { TENANT_SLUG, USERS, uniqueSuffix } from "./fixtures/test-data";

/**
 * Account-enumeration resistance across the three unauthenticated entry points.
 *
 * The property under test is that an attacker cannot tell a registered email from an unregistered
 * one by looking at the response. Login and password-reset were already correct; signup used to
 * answer "An account with this email already exists", which is a direct oracle — one request per
 * address, confirmed or denied.
 *
 * These run without any storageState on purpose: this is the pre-auth surface, and a stray session
 * cookie would change the responses under test.
 */

const SIGNUP_RATE_LIMIT = 3; // per hour per IP, see src/app/api/signup/route.ts

/**
 * These probes deliberately hit rate-limited public endpoints, so a 429 is the control working, not
 * a failure. It has to be checked on *every* response in a comparison, not just the first: if the
 * limit trips between the two calls they differ for a reason that has nothing to do with
 * enumeration, and a security test that cries wolf is worse than no test.
 */
function skipIfRateLimited(...statuses: number[]) {
  test.skip(statuses.includes(429), "rate limited — re-run once the window clears");
}

function anon(baseURL: string) {
  return playwrightRequest.newContext({ baseURL, storageState: undefined });
}

test.describe("Account enumeration", () => {
  test("password reset says the same thing for a real and a fake address", async ({ baseURL }) => {
    const ctx = await anon(baseURL!);
    try {
      const real = await ctx.post("/api/auth/request-password-reset", {
        data: { tenantSlug: TENANT_SLUG, email: USERS.owner.email },
      });
      const fake = await ctx.post("/api/auth/request-password-reset", {
        data: { tenantSlug: TENANT_SLUG, email: `definitely-not-a-user-${uniqueSuffix()}@example.com` },
      });

      skipIfRateLimited(real.status(), fake.status());
      expect(real.status()).toBe(fake.status());
      expect(await real.text()).toBe(await fake.text());
    } finally {
      await ctx.dispose();
    }
  });

  test("password reset says the same thing for a real and a fake tenant", async ({ baseURL }) => {
    const ctx = await anon(baseURL!);
    try {
      const real = await ctx.post("/api/auth/request-password-reset", {
        data: { tenantSlug: TENANT_SLUG, email: USERS.owner.email },
      });
      const fake = await ctx.post("/api/auth/request-password-reset", {
        data: { tenantSlug: `no-such-restaurant-${uniqueSuffix()}`, email: USERS.owner.email },
      });

      skipIfRateLimited(real.status(), fake.status());
      expect(real.status()).toBe(fake.status());
      expect(await real.text()).toBe(await fake.text());
    } finally {
      await ctx.dispose();
    }
  });

  test("signup does not reveal that an email is already registered", async ({ baseURL }) => {
    const ctx = await anon(baseURL!);
    try {
      // A taken email, with an otherwise-valid and unique signup payload — so the only thing that
      // could make this fail is the email.
      const res = await ctx.post("/api/signup", {
        data: {
          restaurantName: "Enumeration Probe",
          slug: `enum-probe-${uniqueSuffix()}`,
          ownerName: "Probe",
          ownerEmail: USERS.owner.email,
          ownerPassword: "Passw0rd!Probe",
          branchName: "Main",
          city: "Karachi",
        },
      });

      // Yields to tenant-isolation.spec.ts, which also needs one of the 3 signups per hour and
      // cannot skip — it has to provision a real second tenant to prove isolation against. Two
      // full-suite runs inside the same hour will exhaust the budget; that is the rate limit doing
      // its job, not a regression.
      test.skip(res.status() === 429, `signup rate limit reached (${SIGNUP_RATE_LIMIT}/hour/IP)`);

      const body = await res.text();
      expect(res.status(), "a duplicate email must not be accepted").toBe(400);
      // The whole point: the message must not confirm the address is registered.
      expect(body).not.toMatch(/already exists/i);
      expect(body).not.toMatch(/already registered/i);
      expect(body).not.toMatch(/taken/i);
      expect(body).toMatch(/couldn't create an account/i);
    } finally {
      await ctx.dispose();
    }
  });

  test("login gives one message whether the email exists or not", async ({ baseURL }) => {
    const ctx = await anon(baseURL!);
    try {
      const attempt = async (email: string) => {
        const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
        const res = await ctx.post("/api/auth/callback/credentials", {
          form: { tenantSlug: TENANT_SLUG, email, password: "definitely-the-wrong-password", csrfToken, json: "true" },
          maxRedirects: 0,
        });
        return { status: res.status(), body: await res.text() };
      };

      // Real address with a wrong password, versus an address that does not exist at all.
      const real = await attempt(USERS.owner.email);
      const fake = await attempt(`nobody-${uniqueSuffix()}@example.com`);

      skipIfRateLimited(real.status, fake.status);
      expect(real.status).toBe(fake.status);
      expect(real.body).toBe(fake.body);
      // And neither response should name the account.
      expect(real.body).not.toMatch(/password/i);
    } finally {
      await ctx.dispose();
    }
  });
});
