/**
 * Pure date arithmetic for recurring expenses. Deliberately no "server-only" import and no Prisma —
 * same reasoning as src/lib/pricing.ts: this is the genuinely fiddly part of the feature (off-by-one
 * month, double-generation, catch-up after a gap), so it lives where it can be unit tested
 * exhaustively without a database. See tests/recurrence.test.ts.
 */

/** Floors a Date to UTC midnight so every comparison here is whole-days. Mixing a stored
 * timestamp's time component into these comparisons is exactly how you end up generating an entry
 * twice on the same day, or skipping one. */
export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Hard stop on the month walk. 10 years is far past any realistic catch-up (worst real case is a
 * cron paused for a few weeks) — this exists purely so a bad date can't spin forever. */
const MAX_MONTHS_TO_SCAN = 120;

export interface OccurrenceParams {
  /** 1-28. Enforced at the API layer, so Date.UTC never rolls into the next month and February
   * needs no special case. */
  dayOfMonth: number;
  startsOn: Date;
  endsOn: Date | null;
  /** spentAt of the newest row already generated for this template. */
  lastGeneratedFor: Date | null;
  today: Date;
}

/**
 * Every occurrence date a template still owes, oldest first.
 *
 * Catch-up is deliberate: a tenant whose cron was paused for two months, or a template created with
 * a back-dated startsOn, gets every missed month generated rather than silently losing them.
 */
/**
 * Recomputes `lastGeneratedFor` when a template's billing day is changed, so the change can't cause
 * a second charge in a month that was already billed.
 *
 * Without this: a template billing on the 1st generates September's rent on 1 Sep, the owner moves
 * it to the 15th, and the next cron run sees 15 Sep as a still-owed occurrence (it's later than the
 * 1st) and bills September twice. Advancing the marker to the new day within the already-generated
 * month makes the change take effect from the *following* month, which is what "I've moved my rent
 * day" actually means.
 *
 * Null in, null out: nothing has been generated yet, so there's nothing to protect.
 */
export function rebaseLastGeneratedFor(lastGeneratedFor: Date | null, newDayOfMonth: number): Date | null {
  if (!lastGeneratedFor) return null;
  const last = utcMidnight(lastGeneratedFor);
  const sameMonthNewDay = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), newDayOfMonth));
  return sameMonthNewDay > last ? sameMonthNewDay : last;
}

export function occurrencesToGenerate(params: OccurrenceParams): Date[] {
  const { dayOfMonth } = params;
  const startsOn = utcMidnight(params.startsOn);
  const endsOn = params.endsOn ? utcMidnight(params.endsOn) : null;
  const lastGeneratedFor = params.lastGeneratedFor ? utcMidnight(params.lastGeneratedFor) : null;
  const today = utcMidnight(params.today);

  // Scan from whichever anchor is later: the template's start date, or what was last generated.
  const anchor = lastGeneratedFor && lastGeneratedFor > startsOn ? lastGeneratedFor : startsOn;
  let year = anchor.getUTCFullYear();
  let month = anchor.getUTCMonth();

  const out: Date[] = [];
  for (let i = 0; i < MAX_MONTHS_TO_SCAN; i++) {
    const candidate = new Date(Date.UTC(year, month, dayOfMonth));

    if (candidate > today) break;
    if (endsOn && candidate > endsOn) break;

    const afterStart = candidate >= startsOn;
    const notAlreadyDone = !lastGeneratedFor || candidate > lastGeneratedFor;
    if (afterStart && notAlreadyDone) out.push(candidate);

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return out;
}
