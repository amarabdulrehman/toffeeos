import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * A restaurant's "day" is a wall-clock day in its own branch's timezone (Branch.timezone), not a
 * UTC day and not the server's day — and it does not have to start at midnight.
 *
 * A café that trades until 2am thinks of 1:30am as the tail of tonight, not the start of tomorrow:
 * that sale belongs in tonight's takings, tonight's drawer and tonight's closing summary. So each
 * branch sets when its day starts (BranchSettings.dayStartMinutes, minutes after midnight), and
 * every function here takes it. At the default of 0 they behave exactly as calendar days always
 * did, so a branch that never changes the setting sees no difference.
 *
 * An earlier version of this comment claimed a 1:30am sale already belonged to the previous day.
 * It did not — the code used the plain calendar date — which is the gap this closes.
 *
 * Extracted from sendDailySummaryForBranch (src/server/whatsapp/triggers.ts), which worked this
 * out first. Deliberately no `server-only` import — the cash drawer, the reports and the unit tests
 * all need it.
 */

/** The latest a day may start: 6am. Past that it stops being "late night" and becomes a shift. */
export const MAX_DAY_START_MINUTES = 6 * 60;

/** "YYYY-MM-DD" plus or minus whole days, on the calendar alone — no timezone involved. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The business day an instant belongs to, as "YYYY-MM-DD".
 *
 * Compares the local wall-clock time against the day's start rather than subtracting hours from
 * the instant, so it stays right across a daylight-saving change — where "four hours earlier" and
 * "before 4am" are not the same thing.
 */
export function businessDayOf(instant: Date, timezone: string, dayStartMinutes = 0): string {
  const [date, time] = formatInTimeZone(instant, timezone, "yyyy-MM-dd HH:mm").split(" ");
  if (dayStartMinutes <= 0) return date;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m < dayStartMinutes ? addDays(date, -1) : date;
}

/**
 * The real UTC instants bounding a "YYYY-MM-DD" business day in the given timezone.
 *
 * Built with fromZonedTime so the boundaries are genuine instants usable in a database query —
 * not the toZonedTime "fake local" Date, which is only safe to hand to formatInTimeZone. Inclusive
 * of both ends (`to` is one millisecond before the next day starts) to match how the report ranges
 * are queried (`lte`). With dayStartMinutes at 0 that is exactly 00:00:00.000 to 23:59:59.999.
 */
export function businessDayRange(day: string, timezone: string, dayStartMinutes = 0): { from: Date; to: Date } {
  const start = hhmm(dayStartMinutes);
  const from = fromZonedTime(`${day} ${start}:00.000`, timezone);
  const nextStart = fromZonedTime(`${addDays(day, 1)} ${start}:00.000`, timezone);
  return { from, to: new Date(nextStart.getTime() - 1) };
}

/** Today's business day for a branch — what "open the drawer" and "close the day" mean by default. */
export function todayFor(timezone: string, now: Date = new Date(), dayStartMinutes = 0): string {
  return businessDayOf(now, timezone, dayStartMinutes);
}

/** Guards a caller-supplied day string before it reaches a query or a unique key. */
export function isBusinessDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  // Rejects "2026-02-31": round-tripping through Date only preserves a real calendar date.
  const [y, m, d] = day.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
