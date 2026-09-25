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

/** How a branch tells the time for business purposes: its timezone, and when its day starts. */
export interface BranchClock {
  timezone: string;
  /** Minutes after midnight the business day starts. 0 is plain calendar days. */
  dayStartMinutes: number;
}

const DEFAULT_TIMEZONE = "Asia/Karachi";

/**
 * The clock every "which day is this?" question for a branch should use — the cash drawer, the
 * reports, the daily summary. Read together so no caller can take the timezone and forget the day
 * start, which would put a 1:30am sale on tomorrow in one screen and tonight in another.
 */
export async function getBranchClock(tenantId: string, branchId: string): Promise<BranchClock> {
  const branch = await tenantDb(tenantId).branch.findUnique({
    where: { id: branchId },
    select: { timezone: true, settings: { select: { dayStartMinutes: true } } },
  });
  return {
    timezone: branch?.timezone ?? DEFAULT_TIMEZONE,
    dayStartMinutes: branch?.settings?.dayStartMinutes ?? 0,
  };
}
