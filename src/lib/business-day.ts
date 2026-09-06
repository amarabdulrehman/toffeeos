import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * A restaurant's "day" is a wall-clock day in its own branch's timezone (Branch.timezone), not a
 * UTC day and not the server's day. A branch that serves until 2am is still on the previous
 * business day at 1:30am, and its opening float belongs to that day's drawer.
 *
 * Extracted from sendDailySummaryForBranch (src/server/whatsapp/triggers.ts), which worked this
 * out first and is now the second caller rather than the only one. Deliberately no `server-only`
 * import — the cash drawer and the transactions report both need it, and so do the unit tests.
 */

/** The calendar day an instant falls on, in the given timezone, as "YYYY-MM-DD". */
export function businessDayOf(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

/**
 * The real UTC instants bounding a "YYYY-MM-DD" business day in the given timezone.
 *
 * Built with fromZonedTime so the boundaries are genuine instants usable in a database query —
 * not the toZonedTime "fake local" Date, which is only safe to hand to formatInTimeZone. Inclusive
 * of both ends (`to` is .999) to match how the existing report ranges are queried (`lte`).
 */
export function businessDayRange(day: string, timezone: string): { from: Date; to: Date } {
  return {
    from: fromZonedTime(`${day} 00:00:00.000`, timezone),
    to: fromZonedTime(`${day} 23:59:59.999`, timezone),
  };
}

/** Today's business day for a branch — what "open the drawer" and "close the day" mean by default. */
export function todayFor(timezone: string, now: Date = new Date()): string {
  return businessDayOf(now, timezone);
}

/** Guards a caller-supplied day string before it reaches a query or a unique key. */
export function isBusinessDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  // Rejects "2026-02-31": round-tripping through Date only preserves a real calendar date.
  const [y, m, d] = day.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
