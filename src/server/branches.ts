import "server-only";
import { tenantDb, runInTenantTransaction } from "@/server/db";
import { HttpError } from "@/server/handler";
import { newId } from "@/lib/ids";
import { getTenantSubscriptionInfo, nextTierUp, TIER_LABEL } from "@/server/tier";

export interface CreateBranchInput {
  name: string;
  address?: string;
}

/** Branch *management* (viewing, editing, adding a branch) is available at every tier — it's the
 * *count* that's gated, per the pricing brief's branch-limit row, not the feature itself. */
export async function createBranch(tenantId: string, input: CreateBranchInput) {
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
    return branch;
  });
}

export async function listBranches(tenantId: string) {
  const db = tenantDb(tenantId);
  return db.branch.findMany({ orderBy: { createdAt: "asc" } });
}
