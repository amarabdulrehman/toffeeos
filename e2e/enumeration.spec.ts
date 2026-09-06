import "dotenv/config";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { Client } from "pg";
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

/**
 * Hands back the signup budget this file just spent.
 *
 * These probes need all three signups per hour, and tenant-isolation.spec.ts needs a fourth to
 * provision the second tenant it proves isolation against — so a full-suite run could never pass
 * both, and it was tenant-isolation (which cannot skip) that failed every time.
 *
 * This is not weakening the limit: the limiter itself is untouched and nothing here tests it — a
 * 429 is an obstacle these probes skip around, not the property under test. It clears the counters
 * for the two endpoints this file hammers, so each run starts from a known state instead of
 * inheriting whatever the last one left; the endpoints stay exactly as rate-limited for real
 * traffic as before. These rows are ephemeral by design — the limiter prunes them itself on every
 * call — and in this database they come from test traffic.
 */
test.afterAll(async () => {
  if (!process.env.DIRECT_URL) return;
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  try {
    await c.connect();
    await c.query(`DELETE FROM "RateLimitHit" WHERE key LIKE 'signup:%' OR key LIKE 'password-reset-request:%'`);
  } catch {
    // Best-effort: the worst case is the pre-existing behaviour, a 429 later in the run.
  } finally {
    await c.end().catch(() => {});
  }
});

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

  test("signup answers identically for a taken and a free email", async ({ baseURL }) => {
    const ctx = await anon(baseURL!);
    const signup = (email: string) =>
      ctx.post("/api/signup", {
        data: {
          restaurantName: "Enumeration Probe",
          slug: `enum-probe-${uniqueSuffix()}`,
          ownerName: "Probe",
          ownerEmail: email,
          ownerPassword: "Passw0rd!Probe",
          branchName: "Main",
          city: "Karachi",
        },
      });

    try {
      // Both payloads are valid and unique apart from the email, so the email is the only variable.
      // A taken email must not be distinguishable from a free one in status *or* body — the taken
      // one silently provisions nothing, which is what enforces one trial per email.
      const taken = await signup(USERS.owner.email);
      const free = await signup(`brand-new-${uniqueSuffix()}@example.com`);
      skipIfRateLimited(taken.status(), free.status());

      const takenBody = await taken.text();
      const freeBody = await free.text();
      expect(taken.status(), "a taken email must look exactly like a successful signup").toBe(free.status());
      expect(takenBody).toBe(freeBody);
      expect(takenBody).not.toMatch(/already|exists|taken|couldn't/i);

      // That the taken-email attempt also creates nothing is asserted in the next test.
    } finally {
      await ctx.dispose();
    }
  });

  test("a taken email provisions nothing, so one trial per email still holds", async ({ baseURL }) => {
    const ctx = await anon(baseURL!);
    const slug = `enum-notcreated-${uniqueSuffix()}`;
    try {
      const res = await ctx.post("/api/signup", {
        data: {
          restaurantName: "Should Not Exist",
          slug,
          ownerName: "Probe",
          ownerEmail: USERS.owner.email, // already registered
          ownerPassword: "Passw0rd!Probe",
          branchName: "Main",
        },
      });
      // Still skips rather than fails: the budget is returned in afterAll, but a manual re-run of
      // this file inside the same window can still land on a 429, and that is the rate limit doing
      // its job, not a regression.
      test.skip(res.status() === 429, `signup rate limit reached (${SIGNUP_RATE_LIMIT}/hour/IP)`);
      expect(res.status()).toBe(201);

      // The storefront for that slug is public, so a real tenant would answer 200 here.
      const check = await ctx.get(`/api/online-order/${slug}`);
      expect(check.status(), "no tenant should have been created for a taken email").not.toBe(200);
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
