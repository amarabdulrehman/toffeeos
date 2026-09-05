/**
 * Shared constants for the E2E suite. Points at the seeded demo tenant (prisma/seed.ts) — every
 * credential here matches what `npx prisma db seed` produces. Tests must never assume these rows
 * are the *only* rows of their kind (this database also carries months of manual test data from
 * before this suite existed) — always scope queries/assertions to something the test itself just
 * created (a fresh idempotencyKey, a freshly-picked table) rather than "the first order" or
 * "the only order."
 */
export const TENANT_SLUG = "karachi-karahi";
export const DEMO_PASSWORD = "Passw0rd!";

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
