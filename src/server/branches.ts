import "server-only";
import { tenantDb, runInTenantTransaction } from "@/server/db";
import { HttpError } from "@/server/handler";
import { newId } from "@/lib/ids";
import { defaultTaxRuleRows } from "@/lib/default-tax-rules";
import { getTenantSubscriptionInfo, nextTierUp, TIER_LABEL } from "@/server/tier";

export interface CreateBranchInput {
  name: string;
  address?: string;
}

/** Branch *management* (viewing, editing, adding a branch) is available at every tier — it's the
 * *count* that's gated, per the pricing brief's branch-limit row, not the feature itself. */
export async function createBranch(tenantId: string, input: CreateBranchInput, creatorUserId?: string) {
  const db = tenantDb(tenantId);
  const [info, activeCount] = await Promise.all([
    getTenantSubscriptionInfo(db),
    db.branch.count({ where: { isActive: true } }),
  ]);

  if (info && info.maxBranches !== null && activeCount >= info.maxBranches) {
    const upgrade = nextTierUp(info.tier);
    const suggestion = upgrade
      ? ` Upgrade to ${TIER_LABEL[upgrade]} for ${upgrade === "complete" ? "unlimited" : "more"} branches.`
      : "";
    throw new HttpError(
      403,
      `Your ${info.planName} plan supports up to ${info.maxBranches} branch${info.maxBranches === 1 ? "" : "es"}.${suggestion}`
    );
  }

  const branchId = newId();
  return runInTenantTransaction(tenantId, async (tx) => {
    const branch = await tx.branch.create({ data: { id: branchId, tenantId, name: input.name, address: input.address } });
    await tx.branchSettings.create({ data: { tenantId, branchId, serviceChargeBasisPoints: 0, roundingMode: "NEAREST_1" } });

    // Tax rates, copied from the restaurant's first branch that has any. A new branch used to get
    // none, and pricing falls back to 0%, so a second branch charged no tax until someone noticed.
    // Same province, same rates, almost always; they stay editable per branch in Settings.
    const source = await tx.branch.findFirst({
      where: { id: { not: branchId }, taxRules: { some: { isActive: true } } },
      orderBy: { createdAt: "asc" },
      select: { taxRules: { where: { isActive: true, effectiveTo: null } } },
    });
    const copied = (source?.taxRules ?? []).map((r) => ({
      tenantId,
      branchId,
      name: r.name,
      paymentMethods: r.paymentMethods,
      rateBasisPoints: r.rateBasisPoints,
    }));
    await tx.taxRule.createMany({ data: copied.length > 0 ? copied : defaultTaxRuleRows(tenantId, branchId) });

    // A stock location, as sign-up gives the first branch: without one, recipe depletion finds
    // nowhere to deduct from and stock never moves (see tenant-signup.ts).
    const stockLocation = await tx.stockLocation.create({ data: { tenantId, branchId, name: "Main Store" } });
    await tx.branchSettings.update({ where: { branchId }, data: { defaultStockLocationId: stockLocation.id } });

    // Somebody has to be able to open it. A branch used to start with no members at all, so the
    // owner who made it could neither switch to it nor set its tax and settings. Every owner, and
    // whoever created it, joins it in the role they hold now; anyone else is invited as usual.
    const holders = await tx.membership.findMany({
      where: { isActive: true, OR: [{ role: { key: "owner" } }, ...(creatorUserId ? [{ userId: creatorUserId }] : [])] },
      select: { userId: true, roleId: true, role: { select: { key: true } } },
      orderBy: { createdAt: "asc" },
    });
    const roleByUser = new Map<string, string>();
    for (const m of holders) {
      // An owner joins as owner even if they also hold a lesser role somewhere.
      if (!roleByUser.has(m.userId) || m.role.key === "owner") roleByUser.set(m.userId, m.roleId);
    }
    if (roleByUser.size > 0) {
      await tx.membership.createMany({
        data: [...roleByUser].map(([userId, roleId]) => ({ tenantId, userId, branchId, roleId })),
      });
    }
    return branch;
  });
}

export async function listBranches(tenantId: string) {
  const db = tenantDb(tenantId);
  return db.branch.findMany({ orderBy: { createdAt: "asc" } });
}

/** The branches this person can work in: one per active membership, on an active branch; an owner
 * can open every active branch. More than one is what puts the branch switcher on screen. */
export async function listMyBranches(tenantId: string, userId: string) {
  const db = tenantDb(tenantId);
  const memberships = await db.membership.findMany({
    where: { userId, isActive: true, branch: { isActive: true } },
    select: { branch: { select: { id: true, name: true } }, role: { select: { key: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.some((m) => m.role.key === "owner")) {
    const all = await db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    // Their own branches first, in the order they joined them, then the rest.
    const mine = memberships.map((m) => m.branch);
    return [...mine, ...all.filter((b) => !mine.some((m) => m.id === b.id))];
  }
  return memberships.map((m) => m.branch);
}

/**
 * An owner switching to a branch they were never added to joins it, as owner.
 *
 * Branches made before new branches started taking their owners along have nobody but whoever was
 * invited to them, and an owner can't be invited to a second branch (an invite makes a new
 * account). Done here, when the owner asks for that branch, rather than to every restaurant at
 * once. A membership that exists but was switched off is left alone: someone decided that.
 */
export async function joinBranchAsOwner(tenantId: string, userId: string, branchId: string) {
  const db = tenantDb(tenantId);
  const [ownerMembership, existing, branch] = await Promise.all([
    db.membership.findFirst({ where: { userId, isActive: true, role: { key: "owner" } }, select: { roleId: true } }),
    db.membership.findFirst({ where: { userId, branchId }, select: { id: true } }),
    db.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } }),
  ]);
  if (!ownerMembership || existing || !branch) return;
  await runInTenantTransaction(tenantId, (tx) =>
    tx.membership.create({ data: { tenantId, userId, branchId, roleId: ownerMembership.roleId } })
  );
}
