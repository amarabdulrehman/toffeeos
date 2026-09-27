import "server-only";
import { platformDb } from "@/server/db";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { issueImpersonationToken } from "@/server/auth/impersonation-store";
import { TIER_ORDER, GATEABLE_MODULES, defaultModulesForTier, type TierKey } from "@/server/tier";
import { getBillingStatus, effectiveMonthlyRatePaisa } from "@/lib/billing";
import { listTenantPayments } from "@/server/billing";
import { TENANT_OWNED_TABLES } from "@/lib/tenant-tables";
import { generateTempPassword, hashPassword } from "@/lib/password";

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

/**
 * Resets one tenant user's password to a generated temporary one, for the support call where a
 * client is locked out.
 *
 * Until this existed there was no way to do that at all: the platform panel could only change a
 * platform admin's *own* password, a tenant owner can only activate/deactivate staff, and the
 * self-service email flow is useless if mail isn't reaching the client. The fallback was editing a
 * bcrypt hash into the database by hand.
 *
 * Three things this deliberately does:
 *
 * - Looks the user up through tenantDb, not platformDb. platformDb has BYPASSRLS, so a lookup by
 *   id alone would happily resolve a user in a *different* tenant than the one named in the URL.
 *   RLS scoping makes that impossible rather than relying on the caller passing a matching pair.
 * - Bumps sessionsValidFrom, so any session that account already has dies on its next request. A
 *   reset that leaves the old session alive is not a reset — and if the reason for the call is
 *   "someone else has my password", it is the whole point.
 * - Forces mustChangePassword, so the temporary one this returns cannot become their real password.
 *
 * The caller shows the temp password once and reads it out. It is never logged or emailed.
 */
export async function resetTenantUserPassword(
  tenantId: string,
  userId: string,
  platformUserId: string,
  platformUserEmail: string
): Promise<{ tempPassword: string; name: string; email: string | null }> {
  const db = tenantDb(tenantId);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new HttpError(404, "That staff member doesn't exist for this restaurant.");

  const tempPassword = generateTempPassword();
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      sessionsValidFrom: new Date(),
    },
  });

  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.user.password.reset",
      entityType: "User",
      entityId: user.id,
      // Records who was reset and by whom. Never the password itself.
      metadata: { platformUserEmail, targetEmail: user.email, targetName: user.name },
    },
  });

  return { tempPassword, name: user.name, email: user.email };
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

/**
 * Whether "ToffeeOS by Krimsols · @krimsols" prints at the foot of this restaurant's receipts and
 * bills. On by default; switched off here, by the platform admin, for a restaurant that has been
 * promised it — never by the restaurant itself.
 */
export async function setTenantReceiptCredit(tenantId: string, on: boolean, platformUserId: string, platformUserEmail: string) {
  const tenant = await platformDb.tenant.findUnique({ where: { id: tenantId }, select: { showReceiptCredit: true } });
  if (!tenant) throw new HttpError(404, "Tenant not found.");
  const updated = await platformDb.tenant.update({ where: { id: tenantId }, data: { showReceiptCredit: on } });
  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.receiptCredit.change",
      entityType: "Tenant",
      entityId: tenantId,
      metadata: { platformUserEmail, from: tenant.showReceiptCredit, to: on },
    },
  });
  return { showReceiptCredit: updated.showReceiptCredit };
}

export interface DeleteTenantResult {
  slug: string;
  name: string;
  rowsDeleted: number;
}

/**
 * Permanently deletes a restaurant and everything belonging to it.
 *
 * This is the most destructive thing the platform can do, and there is no undo — suspending or
 * cancelling (the existing status change) is what "switch it off but keep the data" looks like.
 * The caller must prove intent by passing the tenant's own slug; a mistyped or stale id cannot
 * delete the wrong restaurant, because the slug has to match the row that id resolves to.
 *
 * Runs as a single transaction: a partial delete would leave a half-erased restaurant that is
 * worse than either outcome. Uses platformDb because this crosses every tenant boundary by
 * definition, and raw DELETEs because the table list is dynamic — table names come from the frozen
 * constant above, never from input, and the tenant id is always a bound parameter.
 */
export async function deleteTenant(
  tenantId: string,
  confirmSlug: string,
  actor: { id: string; email: string }
): Promise<DeleteTenantResult> {
  const tenant = await platformDb.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true, name: true },
  });
  if (!tenant) throw new HttpError(404, "That restaurant doesn't exist.");
  if (tenant.slug !== confirmSlug) {
    throw new HttpError(400, `To confirm, type the restaurant's URL exactly: ${tenant.slug}`);
  }

  const rowsDeleted = await platformDb.$transaction(
    async (tx) => {
      let total = 0;
      for (const table of TENANT_OWNED_TABLES) {
        total += await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
      }
      total += await tx.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id = $1`, tenantId);
      return total;
    },
    // Fifty sequential round trips to a database in another region: an empty test tenant already
    // took ~5.3s, so Prisma's 5s default aborted the whole thing with P2028 and rolled it back. A
    // busy restaurant with years of orders is slower still. Two minutes is generous on purpose —
    // this runs once, by hand, and failing halfway is the one outcome worth spending time to avoid.
    { timeout: 120_000, maxWait: 15_000 }
  );

  // Written after the fact and with tenantId null on purpose. AuditLog is itself tenant-scoped, so
  // an entry filed against this tenant would have been destroyed by the deletion it records; the
  // column is nullable precisely so a platform-level action can outlive its subject.
  await platformDb.auditLog.create({
    data: {
      tenantId: null,
      actorId: actor.id,
      action: "platform.tenant.delete",
      entityType: "Tenant",
      entityId: tenantId,
      metadata: { platformUserEmail: actor.email, slug: tenant.slug, name: tenant.name, rowsDeleted },
    },
  });

  return { slug: tenant.slug, name: tenant.name, rowsDeleted };
}
