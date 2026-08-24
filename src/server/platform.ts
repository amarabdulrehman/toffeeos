import "server-only";
import { platformDb } from "@/server/db";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { issueImpersonationToken } from "@/server/auth/impersonation-store";
import { TIER_ORDER, GATEABLE_MODULES, defaultModulesForTier, type TierKey } from "@/server/tier";
import { getBillingStatus, effectiveMonthlyRatePaisa } from "@/lib/billing";
import { listTenantPayments } from "@/server/billing";

export async function platformMetrics() {
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [tenants, collected] = await Promise.all([
    platformDb.tenant.findMany({
      include: { subscription: { include: { plan: true } }, branches: { select: { id: true, isActive: true } } },
    }),
    platformDb.subscriptionPayment.aggregate({
      _sum: { amountPaisa: true },
      where: { voidedAt: null, createdAt: { gte: startOfThisMonth } },
    }),
  ]);

  const byStatus = { TRIALING: 0, ACTIVE: 0, SUSPENDED: 0, CANCELLED: 0 };
  let totalBranches = 0;
  let mrrPaisa = 0;
  let overdueCount = 0;
  let customPricedCount = 0;
  for (const t of tenants) {
    byStatus[t.status] += 1;
    const activeBranches = t.branches.filter((b) => b.isActive).length;
    totalBranches += activeBranches;
    // MRR only counts ACTIVE (paying) tenants — a trialing tenant isn't revenue yet. Uses
    // effectiveMonthlyRatePaisa so a tenant with a negotiated custom price is reflected honestly
    // instead of always being priced as if they paid the plan-formula rate.
    if (t.status === "ACTIVE" && t.subscription) {
      mrrPaisa += effectiveMonthlyRatePaisa({
        customMonthlyPricePaisa: t.subscription.customMonthlyPricePaisa,
        activeBranchCount: activeBranches,
        pricePaisaPerBranchMonth: t.subscription.plan.pricePaisaPerBranchMonth,
      });
      if (t.subscription.customMonthlyPricePaisa != null) customPricedCount += 1;
    }
    if (t.subscription) {
      const billing = getBillingStatus(
        { tenantStatus: t.status, trialEndsAt: t.subscription.trialEndsAt, currentPeriodEnd: t.subscription.currentPeriodEnd },
        now
      );
      if (billing.isOverdue) overdueCount += 1;
    }
  }

  return {
    tenantCount: tenants.length,
    byStatus,
    totalBranches,
    mrrPaisa,
    overdueCount,
    customPricedCount,
    collectedThisMonthPaisa: collected._sum.amountPaisa ?? 0,
  };
}

export async function getTenantDetail(tenantId: string) {
  const tenant = await platformDb.tenant.findUnique({
    where: { id: tenantId },
    include: {
      subscription: { include: { plan: true } },
      branches: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!tenant) throw new HttpError(404, "Tenant not found.");

  const db = tenantDb(tenantId);
  const [users, recentActivity, payments] = await Promise.all([
    db.membership.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true, key: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    platformDb.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
    listTenantPayments(tenantId),
  ]);

  return { tenant, users, recentActivity, payments };
}

/** Issues a one-time impersonation token for the tenant's earliest-created owner membership, and
 * writes the audit trail entry before any session is created — per the Phase 3 brief,
 * impersonation must be logged regardless of whether the platform admin follows through. */
export async function startImpersonation(
  tenantId: string,
  platformUserId: string,
  platformUserEmail: string
): Promise<string> {
  const db = tenantDb(tenantId);
  const ownerMembership = await db.membership.findFirst({
    where: { isActive: true, role: { key: "owner" } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { name: true } } },
  });
  if (!ownerMembership) throw new HttpError(404, "This tenant has no active owner account to impersonate.");

  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.impersonate",
      entityType: "Tenant",
      entityId: tenantId,
      metadata: { platformUserEmail, targetUserId: ownerMembership.userId, targetUserName: ownerMembership.user.name },
    },
  });

  return issueImpersonationToken({
    tenantId,
    targetUserId: ownerMembership.userId,
    platformUserId,
    platformUserEmail,
  });
}

/**
 * Changes a tenant's plan (their tier). Re-points `Subscription.planId`, refreshes the
 * `branchLimit` snapshot, AND resets `enabledModules` to the new tier's default set — per-tenant
 * feature customization is deliberately overwritten here (the API caller is expected to have
 * already confirmed that with the operator; see the confirmation dialog on the tenant detail page),
 * since a tier change is "start over from this tier's preset," not "layer on top of." Never touches
 * any of the tenant's own data, so a downgrade doesn't delete anything in a now-gated module (e.g.
 * delivery/rider records survive a Complete->Growth downgrade, just inaccessible until
 * re-enabled). Every gate reads enabledModules live from this same row on each request, so the
 * change is visible on the tenant's very next request — no re-login, no cache to invalidate.
 * Audit-logged the same way impersonation is.
 */
export async function changeTenantTier(
  tenantId: string,
  planKey: TierKey,
  platformUserId: string,
  platformUserEmail: string
) {
  if (!TIER_ORDER.includes(planKey)) throw new HttpError(400, "Unknown plan.");

  const [subscription, plan] = await Promise.all([
    platformDb.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    platformDb.plan.findUnique({ where: { key: planKey } }),
  ]);
  if (!subscription) throw new HttpError(404, "This tenant has no subscription to change.");
  if (!plan) throw new HttpError(404, "Unknown plan.");

  // A downgrade only ever blocked *creating* a new branch beyond the new limit (see
  // src/server/branches.ts's createBranch) — it never touched branches the tenant already had, so
  // a tenant could be moved onto a cheaper plan and simply keep every branch they already had fully
  // working. Enforcing it here, symmetrically with createBranch, rather than silently
  // deactivating a live restaurant's branches out from under them (a destructive action nobody
  // asked for) — the admin has to actually resolve the mismatch first.
  if (plan.maxBranches !== null) {
    const activeBranches = await platformDb.branch.count({ where: { tenantId, isActive: true } });
    if (activeBranches > plan.maxBranches) {
      throw new HttpError(
        409,
        `This tenant has ${activeBranches} active branches, but ${plan.name} only supports ${plan.maxBranches}. Deactivate ${activeBranches - plan.maxBranches} branch${activeBranches - plan.maxBranches === 1 ? "" : "es"} first, then change the plan.`
      );
    }
  }

  const fromTier = subscription.plan.key;
  const fromModules = subscription.enabledModules;
  const toModules = defaultModulesForTier(planKey);
  await platformDb.subscription.update({
    where: { tenantId },
    data: { planId: plan.id, branchLimit: plan.maxBranches, enabledModules: toModules },
  });

  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.tier.change",
      entityType: "Subscription",
      entityId: subscription.id,
      metadata: { platformUserEmail, fromTier, toTier: planKey, fromModules, toModules },
    },
  });

  return { fromTier, toTier: planKey, enabledModules: toModules };
}

/**
 * Sets a tenant's per-feature toggles directly, independent of tier — the mechanism behind the
 * super-admin per-tenant feature checklist. `enabledModules` must be a subset of every
 * GATEABLE_MODULES storage key; anything else is rejected rather than silently written, since a
 * typo'd module key would otherwise silently do nothing (never matched by moduleForPermission) with
 * no error to signal it. Audit-logged the same way a tier change is, so "who turned Inventory on for
 * this Starter tenant, and when" is always answerable.
 */
export async function setTenantFeatures(
  tenantId: string,
  enabledModules: string[],
  platformUserId: string,
  platformUserEmail: string
) {
  const validKeys = new Set(GATEABLE_MODULES.flatMap((m) => m.storageKeys));
  const invalid = enabledModules.filter((k) => !validKeys.has(k));
  if (invalid.length > 0) throw new HttpError(400, `Unknown feature key(s): ${invalid.join(", ")}`);

  const subscription = await platformDb.subscription.findUnique({ where: { tenantId } });
  if (!subscription) throw new HttpError(404, "This tenant has no subscription to change.");

  const fromModules = subscription.enabledModules;
  const updated = await platformDb.subscription.update({
    where: { tenantId },
    data: { enabledModules },
  });

  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.features.change",
      entityType: "Subscription",
      entityId: subscription.id,
      metadata: { platformUserEmail, fromModules, toModules: enabledModules },
    },
  });

  return { enabledModules: updated.enabledModules };
}
