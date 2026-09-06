import { existsSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";
import { TENANT_SLUG, DEMO_PASSWORD, USERS, authFile, type UserKey } from "./fixtures/test-data";

/**
 * Reuses a previously saved session if it still authenticates as the right user.
 *
 * This matters because login is deliberately rate-limited to 8 attempts per 15 minutes per email
 * (see checkRateLimit in src/server/auth/config.ts). Logging all six roles in afresh on every run
 * means a handful of suite runs in quick succession — completely normal while iterating on a spec —
 * exhausts that budget and the whole suite dies in setup with a confusing CredentialsSignin error.
 *
 * The fix belongs here, not in the rate limit: the limit is a real security control protecting a
 * public endpoint, and weakening it so the tests are more convenient would be trading production
 * safety for developer comfort. Sessions are JWTs that stay valid for days, so reusing one is also
 * simply less wasteful.
 */
async function existingSessionIsValid(baseURL: string, user: UserKey): Promise<boolean> {
  const file = authFile(user);
  if (!existsSync(file)) return false;
  const ctx = await request.newContext({ baseURL, storageState: file });
  try {
    const res = await ctx.get("/api/auth/session");
    if (!res.ok()) return false;
    const session = await res.json();
    if (session?.user?.email !== USERS[user].email) return false;

    // /api/auth/session only decodes the cookie — it does not consult the server, so it happily
    // reports a session that every real endpoint now rejects (a token issued before revocation
    // tracking existed, or one revoked by a sign-out). Probe a route that actually goes through
    // defineHandler: 401 means the session is dead and must be re-issued; 403 is fine, it means
    // the session is alive and this role simply lacks that permission.
    const probe = await ctx.get("/api/expense-categories");
    return probe.status() !== 401;
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

/**
 * Logs in as every seeded role once, up front, via the real NextAuth HTTP flow (not the UI) —
 * exactly the CSRF-token-then-credentials-POST sequence the login form itself performs. Each
 * role's resulting cookies are saved as Playwright storage state, so every spec file just does
 * `test.use({ storageState: authFile("cashier") })` instead of re-driving a login form hundreds of
 * times across the suite. This is a fixture setup step, not a test — it doesn't get its own report
 * entry, and a failure here should fail the whole run loudly (something as basic as "can any seeded
 * user log in" being broken makes every other result meaningless).
 */
async function loginAs(baseURL: string, user: UserKey): Promise<void> {
  const ctx = await request.newContext({ baseURL });
  const { email } = USERS[user];

  const csrfRes = await ctx.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  const loginRes = await ctx.post("/api/auth/callback/credentials", {
    form: {
      tenantSlug: TENANT_SLUG,
      email,
      password: DEMO_PASSWORD,
      csrfToken,
      json: "true",
    },
  });
  if (!loginRes.ok() && loginRes.status() !== 302) {
    throw new Error(`Login failed for ${user} (${email}): ${loginRes.status()} ${await loginRes.text()}`);
  }

  const sessionRes = await ctx.get("/api/auth/session");
  const session = await sessionRes.json();
  if (!session?.user?.email || session.user.email !== email) {
    throw new Error(`Login for ${user} did not produce a valid session: ${JSON.stringify(session)}`);
  }

  await ctx.storageState({ path: authFile(user) });
  await ctx.dispose();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3100";
  const roles = Object.keys(USERS) as UserKey[];
  let reused = 0;
  for (const role of roles) {
    if (await existingSessionIsValid(baseURL, role)) {
      reused++;
      continue;
    }
    await loginAs(baseURL, role);
  }
  if (reused > 0) {
    console.log(`[global-setup] reused ${reused}/${roles.length} existing sessions, logged in ${roles.length - reused}`);
  }
}
