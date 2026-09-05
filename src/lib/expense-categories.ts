/**
 * Day-one expense categories every new tenant starts with. Shared between the real signup path
 * (provisionTenant in src/server/tenant-signup.ts) and the demo seed (prisma/seed.ts) so the two
 * can't drift — the same reason SEED_ROLES lives in one place.
 *
 * Fully editable afterwards: users can add their own and archive any of these.
 *
 * Deliberately NO "Salaries" category. Payroll already owns that number — PayrollDisbursement rows
 * are the system of record for what staff were actually paid — so a hand-entered salary expense
 * would double-count the moment a P&L view lands. Anyone who insists can still create one, but it
 * shouldn't be the path of least resistance.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent",
  "Utilities",
  "Supplies",
  "Repairs & Maintenance",
  "Marketing",
  "Transport",
  "Licenses & Fees",
  "Other",
] as const;

/** Rows ready for a createMany, in the listed order — sortOrder keeps "Other" last in every
 * dropdown rather than letting alphabetical sorting bury it in the middle. */
export function defaultExpenseCategoryRows(tenantId: string) {
  return DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({ tenantId, name, sortOrder: i }));
}
