import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { getTenantSubscriptionInfo, nextTierUp, TIER_LABEL } from "@/server/tier";

const schema = z.object({ isActive: z.boolean() });

// PATCH /api/branches/[branchId] — deactivate/reactivate a branch. No DELETE here on purpose,
// same reasoning as staff membership deactivation: a hard delete would orphan every order,
// inventory movement, and audit-log row tied to it — deactivating preserves that history while
// hiding the branch from staff assignment, the POS branch switcher, and new-order creation.
export const PATCH = defineHandler(
  {
    permission: "branch.manage",
    input: schema,
    audit: (input) => ({
      action: input.isActive ? "branch.reactivate" : "branch.deactivate",
      entityType: "Branch",
    }),
  },
  async ({ db, params, input }) => {
    const branch = await db.branch.findFirst({ where: { id: params.branchId } });
    if (!branch) throw new HttpError(404, "Not found");

    const activeCount = await db.branch.count({ where: { isActive: true } });

    if (!input.isActive) {
      if (activeCount <= 1) {
        throw new HttpError(400, "You can't deactivate your only active branch.");
      }
    } else if (!branch.isActive) {
      // Reactivating raises the active count exactly like creating a new branch does — same cap,
      // same message, so a tenant can't sidestep the limit by deactivating then reactivating.
      const info = await getTenantSubscriptionInfo(db);
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
    }

    await db.branch.update({ where: { id: params.branchId }, data: { isActive: input.isActive } });
    return { ok: true };
  }
);
