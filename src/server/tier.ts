import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { TIER_ORDER, type TierKey } from "@/lib/tiers";

export {
  TIER_ORDER,
  TIER_LABEL,
  minTierForPermission,
  tierMeets,
  nextTierUp,
  type TierKey,
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
 * The one query defineHandler actually needs on every request: tier (for the permission's tier
 * gate) and the tenant's lifecycle status (suspended/cancelled tenants lose API access immediately,
 * not just new logins), fetched together via Subscription's own `tenant` relation instead of two
 * separate round trips to a remote Postgres instance — each of those was independently measured
 * adding real, consistent per-request latency (~1.3s sequential, not a dev-compile artifact), so
 * this consolidation is a genuine fix, not premature optimization.
 */
export async function getTenantGate(db: PrismaClient): Promise<{ tier: TierKey; tenantStatus: string | null }> {
  const subscription = await db.subscription.findFirst({ include: { plan: true, tenant: { select: { status: true } } } });
  return {
    tier: isTierKey(subscription?.plan.key) ? subscription!.plan.key : "starter",
    tenantStatus: subscription?.tenant.status ?? null,
  };
}
