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

/** Per-request account state, read in the same round trip as the tenant row. `null` means the user
 * row is gone or not visible to this tenant. */
interface RawUserRow {
  isActive: boolean;
  /** Epoch milliseconds, computed in SQL rather than parsed from a Date on purpose.
   *
   * sessionsValidFrom is `timestamp without time zone`. Prisma writes a JS Date's *UTC* wall clock
   * into it and reads it back the same way, but node-postgres — which rawPool uses — parses that
   * same column as *local* time. On a UTC+5 host the two disagree by five hours, so comparing a
   * Prisma-stamped token against a pg-parsed gate value silently never matched and revocation did
   * nothing. EXTRACT(EPOCH …) reads the stored wall clock as UTC, which is exactly what Prisma
   * wrote, and returns a number no driver can reinterpret. */
  sessionsValidFromMs: string;
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

async function fetchTenantRow(
  tenantId: string,
  userId?: string
): Promise<{ tenant: RawTenantRow | null; user: RawUserRow | null }> {
  if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenantId");
  // Same guard as tenantId, and for the same reason: this runs as a multi-statement simple query
  // (set_config + SELECT in one round trip), which cannot take bind parameters, so both ids are
  // interpolated and both must be proven to be UUIDs first.
  if (userId !== undefined && !UUID_RE.test(userId)) throw new Error("Invalid userId");
  const client = await rawPool.connect();
  try {
    // The user lookup rides along in the same statement batch rather than a second round trip —
    // this is the hot path on every API request, and the tenant-gate query was itself consolidated
    // for exactly that reason (see the note in defineHandler). It reads User *after* set_config, so
    // RLS scopes it to this tenant automatically: a userId from another tenant returns no row.
    const userSelect = userId
      ? `SELECT "isActive", (EXTRACT(EPOCH FROM "sessionsValidFrom") * 1000)::bigint AS "sessionsValidFromMs" FROM "User" WHERE id = '${userId}';`
      : "";
    const result = (await client.query(`
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      SELECT s."enabledModules" AS "enabledModules", p.key AS plan_key, t.status AS tenant_status,
             s."trialEndsAt" AS trial_ends_at, s."currentPeriodEnd" AS current_period_end
      FROM "Subscription" s
      JOIN "Plan" p ON s."planId" = p.id
      JOIN "Tenant" t ON s."tenantId" = t.id
      WHERE s."tenantId" = '${tenantId}';
      ${userSelect}
    `)) as unknown as QueryResult<RawTenantRow & RawUserRow>[];
    return {
      tenant: (result[1].rows[0] as RawTenantRow) ?? null,
      user: userId ? ((result[2]?.rows[0] as RawUserRow) ?? null) : null,
    };
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
  tenantId: string,
  userId?: string
): Promise<{
  tier: TierKey;
  tenantStatus: string | null;
  enabledModules: string[];
  /** False when the account has been deactivated, or its row is no longer visible to this tenant.
   * Undefined when no userId was passed (callers that only want tier/module info). */
  userActive?: boolean;
  /** Epoch ms. A session stamped earlier than this has been revoked — see User.sessionsValidFrom. */
  sessionsValidFrom?: number;
}> {
  const { tenant: row, user } = await fetchTenantRow(tenantId, userId);
  const tier = isTierKey(row?.plan_key) ? row!.plan_key : "starter";
  return {
    tier,
    tenantStatus: row?.tenant_status ?? null,
    userActive: userId ? (user?.isActive ?? false) : undefined,
    sessionsValidFrom: user ? Number(user.sessionsValidFromMs) : undefined,
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
  /** Whether the *session* is still good, not just the tenant. Undefined when no userId was given.
   * The API layer rejects a deactivated or revoked session on every call; without this the page
   * shell still rendered for them — full nav, every screen — with each action silently failing
   * underneath. Same page-shell gap the tenant-suspension check below already closes. */
  sessionValid?: boolean;
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
export const getTenantLayoutDataForTenant = cache(
  async (tenantId: string, userId?: string, tokenValidFrom?: number): Promise<TenantLayoutData> => {
    const { tenant: row, user } = await fetchTenantRow(tenantId, userId);
    const tier = isTierKey(row?.plan_key) ? row!.plan_key : "starter";
    return {
      enabledModules: row?.enabledModules ?? defaultModulesForTier(tier),
      tenantStatus: row?.tenant_status ?? null,
      trialEndsAt: row?.trial_ends_at ?? null,
      currentPeriodEnd: row?.current_period_end ?? null,
      sessionValid: userId
        ? !!user?.isActive &&
          tokenValidFrom !== undefined &&
          Number(user.sessionsValidFromMs) <= tokenValidFrom
        : undefined,
    };
  }
);

/** Thin wrapper over getTenantLayoutDataForTenant so the 8 gated pages that only need the feature
 * toggles (app/app/{inventory,customers,delivery,whatsapp,online-ordering,hr,menu,tables}/page.tsx,
 * plus the rider layout) keep sharing the same cache() entry the back-office layout already
 * populated, instead of each re-fetching or needing their own edit. */
export const getTenantModulesForTenant = cache(async (tenantId: string): Promise<string[]> => {
  return (await getTenantLayoutDataForTenant(tenantId)).enabledModules;
});
