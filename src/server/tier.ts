import "server-only";
import { cache } from "react";
import type { QueryResult } from "pg";
import type { PrismaClient } from "@/generated/prisma/client";
import { rawPool } from "@/server/db";
import { TIER_ORDER, defaultModulesForTier, type TierKey } from "@/lib/tiers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawTenantRow {
  enabledModules: string[];
  plan_key: string;
  tenant_status: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
}

/**
 * Shared by getTenantGate and getTenantLayoutDataForTenant — both need the identical
 * subscription+plan+tenant join (the layout just also wants two date columns for its renewal
 * banner, included here unconditionally since selecting a couple of extra columns costs nothing
 * extra over the network). Deliberately NOT wrapped in React's cache() here — getTenantGate is
 * called from API route handlers, outside any React render pass, where cache() is a no-op;
 * getTenantLayoutDataForTenant applies its own cache() wrapper below, same as it already did.
 *
 * Bypasses Prisma for this one query on purpose — see rawPool's doc comment in src/server/db.ts
 * for the measured, concrete reason (4 network round trips via Prisma's $transaction([...]) vs. 1
 * via a hand-written multi-statement query here) and why this isn't generalized into tenantDb().
 * Same role (app_user, RLS-bound) and same set_config mechanism as every other tenant-scoped
 * query — this changes round-trip count, not the tenant-isolation guarantee.
 */
async function fetchTenantRow(tenantId: string): Promise<RawTenantRow | null> {
  if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenantId");
  const client = await rawPool.connect();
  try {
    const result = (await client.query(`
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      SELECT s."enabledModules" AS "enabledModules", p.key AS plan_key, t.status AS tenant_status,
             s."trialEndsAt" AS trial_ends_at, s."currentPeriodEnd" AS current_period_end
      FROM "Subscription" s
      JOIN "Plan" p ON s."planId" = p.id
      JOIN "Tenant" t ON s."tenantId" = t.id
      WHERE s."tenantId" = '${tenantId}';
    `)) as unknown as QueryResult<RawTenantRow>[];
    return result[1].rows[0] ?? null;
  } finally {
    client.release();
  }
}

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
 * relation, and via fetchTenantRow's single-round-trip raw query (see its doc comment) rather than
 * Prisma's own $transaction([...]), since this runs on literally every authenticated request.
 * Takes tenantId directly now, not a tenantDb() client — there's no Prisma query left to scope.
 */
export async function getTenantGate(
  tenantId: string
): Promise<{ tier: TierKey; tenantStatus: string | null; enabledModules: string[] }> {
  const row = await fetchTenantRow(tenantId);
  const tier = isTierKey(row?.plan_key) ? row!.plan_key : "starter";
  return {
    tier,
    tenantStatus: row?.tenant_status ?? null,
    // No subscription row at all shouldn't happen for a real tenant, but falls back to the tier's
    // own defaults rather than an empty set — "no toggles configured yet" reads as "not entitled to
    // anything," which a starter default already correctly represents (starter's defaults are []).
    enabledModules: row?.enabledModules ?? defaultModulesForTier(tier),
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
  const row = await fetchTenantRow(tenantId);
  const tier = isTierKey(row?.plan_key) ? row!.plan_key : "starter";
  return {
    enabledModules: row?.enabledModules ?? defaultModulesForTier(tier),
    tenantStatus: row?.tenant_status ?? null,
    trialEndsAt: row?.trial_ends_at ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
  };
});

/** Thin wrapper over getTenantLayoutDataForTenant so the 8 gated pages that only need the feature
 * toggles (app/app/{inventory,customers,delivery,whatsapp,online-ordering,hr,menu,tables}/page.tsx,
 * plus the rider layout) keep sharing the same cache() entry the back-office layout already
 * populated, instead of each re-fetching or needing their own edit. */
export const getTenantModulesForTenant = cache(async (tenantId: string): Promise<string[]> => {
  return (await getTenantLayoutDataForTenant(tenantId)).enabledModules;
});
