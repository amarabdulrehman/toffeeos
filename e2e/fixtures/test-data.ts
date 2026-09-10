// Loaded here rather than relying on each spec: DEMO_PASSWORD below is resolved at module-eval
// time, and this file is imported by global-setup and 20-odd specs, not all of which load dotenv
// first.
import "dotenv/config";

/**
 * Shared constants for the E2E suite. Points at the seeded demo tenant (prisma/seed.ts) — every
 * credential here matches what `npx prisma db seed` produces. Tests must never assume these rows
 * are the *only* rows of their kind (this database also carries months of manual test data from
 * before this suite existed) — always scope queries/assertions to something the test itself just
 * created (a fresh idempotencyKey, a freshly-picked table) rather than "the first order" or
 * "the only order."
 */
export const TENANT_SLUG = "karachi-karahi";

/**
 * Read from the environment, never committed. This used to be the literal string "Passw0rd!", which
 * is also what prisma/seed.ts wrote into the database — so the demo tenant's owner account on the
 * live, publicly reachable deployment was openable by anyone who read this file. Since dev, test and
 * production share one database (see PRE_LAUNCH_REPORT.md §2.4), that was a working unauthorized
 * login on production rather than a local-only inconvenience.
 *
 * Deliberately throws rather than falling back to a default: a fallback would silently restore the
 * exact problem the moment the variable went missing, and a suite that cannot log in should say why.
 */
function requireDemoPassword(): string {
  const value = process.env.DEMO_SEED_PASSWORD;
  if (!value) {
    throw new Error(
      "DEMO_SEED_PASSWORD is not set. The E2E suite signs in as the seeded demo staff and there is " +
        "no committed default on purpose. Add it to .env (it is gitignored) — the value is whatever " +
        "prisma/seed.ts last wrote for the demo tenant."
    );
  }
  return value;
}

export const DEMO_PASSWORD = requireDemoPassword();

export const USERS = {
  owner: { email: "owner@karachikarahi.pk", role: "owner" },
  manager: { email: "manager@karachikarahi.pk", role: "branch_manager" },
  cashier: { email: "cashier@karachikarahi.pk", role: "cashier" },
  waiter: { email: "waiter@karachikarahi.pk", role: "waiter" },
  kitchen: { email: "kitchen@karachikarahi.pk", role: "kitchen" },
  rider: { email: "rider@karachikarahi.pk", role: "rider" },
} as const;

export type UserKey = keyof typeof USERS;

export function authFile(user: UserKey): string {
  return `e2e/.auth/${user}.json`;
}

/** A menu item that's part of the base seed and unlikely to ever be renamed/removed casually. */
export const SEED_MENU_ITEM = { name: "Beef Chapli Kebab", pricePaisa: 48_000 };
export const SEED_MENU_ITEM_2 = { name: "Dahi Bhalla", pricePaisa: 25_000 };

/** Unique-enough per test run to never collide with old data or a concurrent run. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
