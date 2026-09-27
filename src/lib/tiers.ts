// Pure tier constants/helpers, deliberately with no "server-only" import (unlike src/server/tier.ts,
// which re-exports all of this plus the DB-touching lookups) — this file gets imported into client
// components too (sidebar nav gating, the platform admin's tier picker), so it must stay free of
// server-only code.

export const TIER_ORDER = ["starter", "growth", "complete"] as const;
export type TierKey = (typeof TIER_ORDER)[number];

export const TIER_LABEL: Record<TierKey, string> = {
  starter: "Starter",
  growth: "Growth",
  complete: "Complete",
};

/**
 * How many branches each plan allows; null is no limit. prisma/seed.ts writes these to
 * Plan.maxBranches, which is what adding or reactivating a branch is checked against
 * (src/server/branches.ts), and the homepage's plan cards print them — one list, so the page can't
 * promise a branch the app would refuse.
 */
export const TIER_MAX_BRANCHES: Record<TierKey, number | null> = {
  starter: 1,
  growth: 3,
  complete: null,
};

/**
 * Feature-to-tier mapping, per the pricing brief's grid. Keyed by the first segment of a
 * permission key (its "module"), since that's the granularity the tier table is drawn at — every
 * permission under `inventory.*` moves together, for example. Modules absent here (pos, kds,
 * tables, menu, orders, reports [handled per-key below], sync, staff, settings, branch, finance,
 * billing) are administrative or core-operational surface the tier grid doesn't mention, so they're
 * available at every tier by default — this was a judgment call where the brief was silent, flagged
 * in the Phase D report rather than assumed silently.
 */
const MODULE_MIN_TIER: Partial<Record<string, TierKey>> = {
  inventory: "growth",
  recipe: "growth",
  costing: "growth",
  crm: "growth",
  // `finance` (expense tracking) was ungated until Phase 8 simply because nothing consumed the
  // finance.* permissions yet — they were declared in the original design and left unbuilt. Placed
  // at growth alongside Inventory/Recipe/CRM: it's the "you're running a real business now" tier,
  // and expense tracking is only useful to someone already tracking stock and costs.
  finance: "growth",
  delivery: "complete",
  online: "complete",
  whatsapp: "complete",
  hr: "complete",
};

/** Within `reports`, only the "full suite" reports are gated — sales and staff-performance stay on
 * every tier per the brief's "Basic Reports" row. `reports.riderPerformance.view` isn't named in
 * the brief's table at all; it's placed at Complete here since it's meaningless without Delivery &
 * Rider Management, which is itself Complete-only — flagged as an inference, not a stated tier. */
const GROWTH_REPORT_KEYS = new Set<string>([
  "reports.discountVoid.view",
  "reports.inventoryValuation.view",
  "reports.cancellation.view",
]);
const COMPLETE_REPORT_KEYS = new Set<string>(["reports.riderPerformance.view"]);

export function tierMeets(have: TierKey, need: TierKey): boolean {
  return TIER_ORDER.indexOf(have) >= TIER_ORDER.indexOf(need);
}

export function nextTierUp(tier: TierKey): TierKey | null {
  const i = TIER_ORDER.indexOf(tier);
  return i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

// ============================================================================
// Per-tenant feature toggles (extends the Phase D tier grid above). Tier now only decides the
// *default* set of enabled modules a tenant starts with — the actual gate everywhere (server
// permission checks, nav visibility) reads Subscription.enabledModules, a per-tenant, freely
// toggleable set that a platform admin can override feature-by-feature without it ever snapping
// back to the tier preset except when the tier itself is deliberately changed. See
// src/server/platform.ts (setTenantFeatures, changeTenantTier) and the super-admin
// per-tenant feature screen.
// ============================================================================

/** One row of the super-admin feature checklist. `storageKeys` are the raw module keys actually
 * written to/read from Subscription.enabledModules — almost always just [key], except Recipe &
 * Costing, which is one user-facing toggle over two internally-distinct permission modules
 * (`recipe.*` and `costing.*`) that have always moved together per the Phase D tier grid. */
export interface GateableModule {
  key: string;
  label: string;
  minTier: TierKey;
  storageKeys: string[];
}

export const GATEABLE_MODULES: GateableModule[] = [
  { key: "inventory", label: "Inventory", minTier: "growth", storageKeys: ["inventory"] },
  { key: "recipe", label: "Recipe & Costing", minTier: "growth", storageKeys: ["recipe", "costing"] },
  { key: "crm", label: "CRM", minTier: "growth", storageKeys: ["crm"] },
  { key: "finance", label: "Expenses", minTier: "growth", storageKeys: ["finance"] },
  { key: "reports", label: "Full Report Suite", minTier: "growth", storageKeys: ["reports"] },
  { key: "delivery", label: "Delivery & Rider Management", minTier: "complete", storageKeys: ["delivery"] },
  { key: "online", label: "Online Ordering", minTier: "complete", storageKeys: ["online"] },
  { key: "whatsapp", label: "WhatsApp Messaging", minTier: "complete", storageKeys: ["whatsapp"] },
  { key: "hr", label: "Payroll & HR", minTier: "complete", storageKeys: ["hr"] },
];

/** The tier's preset — reused as the default `enabledModules` set whenever a tenant is created or
 * its tier is changed. Reproduces the exact Phase D bundles (every module a tier already unlocked
 * is on by default), per the brief: "reuse the existing Phase D mapping as the default for each
 * tier." */
export function defaultModulesForTier(tier: TierKey): string[] {
  return GATEABLE_MODULES.filter((m) => tierMeets(tier, m.minTier)).flatMap((m) => m.storageKeys);
}

/** Given a permission key, returns the raw storage module key that gates it (matching an entry in
 * some GateableModule.storageKeys), or null if this permission isn't gateable at all — what
 * enforcement actually checks (Subscription.enabledModules), rather than a tier.
 * `reports.riderPerformance.view` is tied to the Delivery module rather than a "reports" toggle,
 * same inference as the Phase D grid: it's meaningless without rider data, which only exists once
 * Delivery is on. */
export function moduleForPermission(permissionKey: string): string | null {
  if (GROWTH_REPORT_KEYS.has(permissionKey)) return "reports";
  if (COMPLETE_REPORT_KEYS.has(permissionKey)) return "delivery";
  const moduleKey = permissionKey.split(".")[0];
  return moduleKey in MODULE_MIN_TIER ? moduleKey : null;
}
