import "server-only";
import { tenantDb } from "@/server/db";

/** Whether this branch wants the Kitchen Display System at all — some cafes run the kitchen right
 * at the counter off a printed KOT and have no use for a dedicated KDS screen. Purely a per-branch
 * operational preference the owner sets in Branches settings, unrelated to subscription tier
 * (unlike GATEABLE_MODULES) — a multi-branch tenant can have this on for one location and off for
 * another. Checked wherever KDS is surfaced (nav link, dashboard quick action) or gated (the /kds
 * route itself), in ADDITION to the existing kds.access permission, not instead of it. */
export async function getBranchKdsEnabled(tenantId: string, branchId: string): Promise<boolean> {
  const settings = await tenantDb(tenantId).branchSettings.findUnique({ where: { branchId }, select: { kdsEnabled: true } });
  return settings?.kdsEnabled ?? true;
}
