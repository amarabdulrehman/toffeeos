import "server-only";
import { cache } from "react";
import type { PrismaClient } from "@/generated/prisma/client";
import { tenantDb } from "@/server/db";
import { TIER_ORDER, defaultModulesForTier, type TierKey } from "@/lib/tiers";

export {
  TIER_ORDER,
  TIER_LABEL,
  minTierForPermission,
  moduleForPermission,
  tierMeets,
  nextTierUp,
  defaultModulesForTier,
  GATEABLE_MODULES,
  type TierKey,
  type GateableModule,
} from "@/lib/tiers";

function isTierKey(value: string | undefined): value is TierKey {
  return !!value && (TIER_ORDER as readonly string[]).includes(value);
}

/**
 * The tier is never cached on the session/JWT — a platform admin's tier change must take effect on
 * the tenant's very next request, not require a re-login, so every gated request re-reads it live.
 * `db` must already be tenant-scoped (defineHandler's `db`, or `tenantDb(tenantId)` from a Server
 * Component) — Subscription is RLS-protected like any other tenant table.
 */
export async function getTenantTier(db: PrismaClient): Promise<TierKey> {
  const subscription = await db.subscription.findFirst({ include: { plan: true } });
  return isTierKey(subscription?.plan.key) ? subscription!.plan.key : "starter";
}

/** Full detail alongside the tier, for callers that also need the plan's branch limit (e.g. branch
 * creation) — same one query, just returning more of it instead of a second round trip. */
export async function getTenantSubscriptionInfo(
  db: PrismaClient
): Promise<{ tier: TierKey; planName: string; maxBranches: number | null } | null> {
  const subscription = await db.subscription.findFirst({ include: { plan: true } });
  if (!subscription) return null;
  return {
    tier: isTierKey(subscription.plan.key) ? subscription.plan.key : "starter",
    planName: subscription.plan.name,
    maxBranches: subscription.plan.maxBranches,
  };
}

/**
 * The one query defineHandler actually needs on every request: tier (kept for display/messaging
 * only — see moduleForPermission's doc comment), the tenant's per-feature toggle set (what
 * enforcement actually checks), and the tenant's lifecycle status (suspended/cancelled tenants lose
 * API access immediately, not just new logins) — fetched together via Subscription's own `tenant`
 * relation instead of separate round trips to a remote Postgres instance — each of those was
 * independently measured adding real, consistent per-request latency (~1.3s sequential, not a
 * dev-compile artifact), so this consolidation is a genuine fix, not premature optimization.
 */
export async function getTenantGate(
  db: PrismaClient
): Promise<{ tier: TierKey; tenantStatus: string | null; enabledModules: string[] }> {
  const subscription = await db.subscription.findFirst({ include: { plan: true, tenant: { select: { status: true } } } });
  const tier = isTierKey(subscription?.plan.key) ? subscription!.plan.key : "starter";
  return {
    tier,
    tenantStatus: subscription?.tenant.status ?? null,
    // No subscription row at all shouldn't happen for a real tenant, but falls back to the tier's
    // own defaults rather than an empty set — "no toggles configured yet" reads as "not entitled to
    // anything," which a starter default already correctly represents (starter's defaults are []).
    enabledModules: subscription?.enabledModules ?? defaultModulesForTier(tier),
  };
}

/** Server Component counterpart to getTenantTier, for the feature-page gates
 * (app/app/{inventory,customers,delivery,whatsapp,online-ordering,hr,menu,tables}/page.tsx) — reads
 * the tenant's actual per-feature toggle set instead of deriving availability from tier alone. */
export async function getTenantModules(db: PrismaClient): Promise<string[]> {
  const subscription = await db.subscription.findFirst({ include: { plan: true } });
  const tier = isTierKey(subscription?.plan.key) ? subscription!.plan.key : "starter";
  return subscription?.enabledModules ?? defaultModulesForTier(tier);
}

export interface TenantLayoutData {
  enabledModules: string[];
  tenantStatus: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * One query for everything app/app/layout.tsx needs: the sidebar's feature toggles AND the dates
 * the tenant-facing renewal banner reads — fetched together rather than as two round trips, same
 * reasoning as getTenantGate's consolidation (a prior duplicate-query regression on this exact
 * layout path was measured at ~1.3s before that fix). Deduplicated across a single request via
 * React's cache(), keyed by tenantId (a primitive) rather than a PrismaClient instance —
 * tenantDb() returns a fresh $extends() wrapper on every call, so caching by the `db` argument's
 * identity would never actually hit. cache() only dedupes within one render pass, so a platform
 * admin's tier/feature/billing change still reaches this tenant's very next page load — this is a
 * pure dedup, not a staleness trade-off. */
export const getTenantLayoutDataForTenant = cache(async (tenantId: string): Promise<TenantLayoutData> => {
  const db = tenantDb(tenantId);
  const subscription = await db.subscription.findFirst({ include: { plan: true, tenant: { select: { status: true } } } });
  const tier = isTierKey(subscription?.plan.key) ? subscription!.plan.key : "starter";
  return {
    enabledModules: subscription?.enabledModules ?? defaultModulesForTier(tier),
    tenantStatus: subscription?.tenant.status ?? null,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
  };
});

/** Thin wrapper over getTenantLayoutDataForTenant so the 8 gated pages that only need the feature
 * toggles (app/app/{inventory,customers,delivery,whatsapp,online-ordering,hr,menu,tables}/page.tsx,
 * plus the rider layout) keep sharing the same cache() entry the back-office layout already
 * populated, instead of each re-fetching or needing their own edit. */
export const getTenantModulesForTenant = cache(async (tenantId: string): Promise<string[]> => {
  return (await getTenantLayoutDataForTenant(tenantId)).enabledModules;
});
