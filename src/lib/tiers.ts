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
]);
const COMPLETE_REPORT_KEYS = new Set<string>(["reports.riderPerformance.view"]);

/** Given a permission key (e.g. "inventory.item.manage"), returns the minimum tier that grants it.
 * `costing.viewMargins` is the "recipe margin" report named in the brief. */
export function minTierForPermission(permissionKey: string): TierKey {
  if (GROWTH_REPORT_KEYS.has(permissionKey)) return "growth";
  if (COMPLETE_REPORT_KEYS.has(permissionKey)) return "complete";
  const moduleKey = permissionKey.split(".")[0];
  return MODULE_MIN_TIER[moduleKey] ?? "starter";
}

export function tierMeets(have: TierKey, need: TierKey): boolean {
  return TIER_ORDER.indexOf(have) >= TIER_ORDER.indexOf(need);
}

export function nextTierUp(tier: TierKey): TierKey | null {
  const i = TIER_ORDER.indexOf(tier);
  return i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}
