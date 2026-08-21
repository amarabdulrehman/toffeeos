import "server-only";
import { platformDb } from "@/server/db";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { issueImpersonationToken } from "@/server/auth/impersonation-store";
import { TIER_ORDER, type TierKey } from "@/server/tier";

export async function platformMetrics() {
  const tenants = await platformDb.tenant.findMany({
    include: { subscription: { include: { plan: true } }, branches: { select: { id: true, isActive: true } } },
  });

  const byStatus = { TRIALING: 0, ACTIVE: 0, SUSPENDED: 0, CANCELLED: 0 };
  let totalBranches = 0;
  let mrrPaisa = 0;
  for (const t of tenants) {
    byStatus[t.status] += 1;
    const activeBranches = t.branches.filter((b) => b.isActive).length;
    totalBranches += activeBranches;
    // MRR only counts ACTIVE (paying) tenants, priced off their actual plan — a trialing tenant
    // isn't revenue yet, and a Starter tenant shouldn't be priced as if it were Growth.
    if (t.status === "ACTIVE" && t.subscription) {
      mrrPaisa += activeBranches * t.subscription.plan.pricePaisaPerBranchMonth;
    }
  }

  return { tenantCount: tenants.length, byStatus, totalBranches, mrrPaisa };
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
  const [users, recentActivity] = await Promise.all([
    db.membership.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true, key: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    platformDb.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return { tenant, users, recentActivity };
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
 * Changes a tenant's plan (their tier). Deliberately just re-points `Subscription.planId` and
 * refreshes the `branchLimit` snapshot — it never touches any of the tenant's own data, so a
 * downgrade doesn't delete anything in a now-gated module (e.g. delivery/rider records survive a
 * Complete->Growth downgrade, just inaccessible until re-upgraded). Every tier-gated check reads
 * the tier live from this same row on each request, so the change is visible on the tenant's very
 * next request — no re-login, no cache to invalidate. Audit-logged the same way impersonation is.
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

  const fromTier = subscription.plan.key;
  await platformDb.subscription.update({
    where: { tenantId },
    data: { planId: plan.id, branchLimit: plan.maxBranches },
  });

  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.tier.change",
      entityType: "Subscription",
      entityId: subscription.id,
      metadata: { platformUserEmail, fromTier, toTier: planKey },
    },
  });

  return { fromTier, toTier: planKey };
}
