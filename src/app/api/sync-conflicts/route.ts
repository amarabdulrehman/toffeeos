import { defineHandler } from "@/server/handler";
import { listConflicts } from "@/server/sync-conflicts";
import { resolveReportBranchIds } from "@/server/reports";

// GET /api/sync-conflicts — open (and recently resolved) offline-sync conflicts for a manager to
// review. Same branch-scoping helper as the report suite: Branch Manager sees their own branch,
// Owner sees every branch.
export const GET = defineHandler({ permission: "sync.conflict.resolve" }, async ({ session }) => {
  const branchIds = await resolveReportBranchIds(session);
  const conflicts = await listConflicts(session.tenantId, branchIds);
  return { conflicts };
});
