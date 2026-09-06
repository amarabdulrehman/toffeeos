import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { uniqueSuffix } from "./test-data";

/**
 * A disposable platform super-admin, for specs that exercise /api/platform/* routes.
 *
 * Deliberately not the real super-admin: those routes need a working platform session, and
 * borrowing the live account would mean rewriting the password hash of the single most powerful
 * credential in the system — which a crash mid-test would leave rewritten. A throwaway account
 * with no 2FA costs one row and leaves the real one untouched.
 *
 * Always call the returned `restore()` in a finally block; global-teardown sweeps up any that a
 * hard crash leaves behind (they all share the deladmin- email prefix).
 */
export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface PlatformAdminSession {
  ctx: APIRequestContext;
  restore: () => Promise<void>;
}

export async function platformAdmin(baseURL: string): Promise<PlatformAdminSession> {
  const bcrypt = await import("bcryptjs");
  const email = `deladmin-${uniqueSuffix()}@example.com`;
  const password = `Test!${uniqueSuffix()}`;
  const passwordHash = await bcrypt.hash(password, 10);

  await withDb((c) =>
    c.query('INSERT INTO "PlatformUser" (id, email, "passwordHash", name) VALUES (gen_random_uuid(), $1, $2, $3)', [
      email,
      passwordHash,
      "Platform Test Admin",
    ])
  );

  const ctx = await playwrightRequest.newContext({ baseURL, storageState: undefined });
  const { csrfToken } = await (await ctx.get("/api/auth/csrf")).json();
  const login = await ctx.post("/api/auth/callback/platform-credentials", {
    form: { email, password, csrfToken, json: "true" },
  });
  if (!login.ok() && login.status() !== 302) {
    throw new Error(`Platform login failed: ${login.status()} ${await login.text()}`);
  }

  const restore = async () => {
    await ctx.dispose();
    await withDb((c) => c.query('DELETE FROM "PlatformUser" WHERE email = $1', [email]));
  };
  return { ctx, restore };
}
