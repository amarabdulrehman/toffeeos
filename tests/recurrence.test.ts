import { describe, expect, it } from "vitest";
import { occurrencesToGenerate, rebaseLastGeneratedFor, utcMidnight } from "@/lib/recurrence";

/** Terse helper so the cases below read as dates, not Date constructor noise. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10));

describe("occurrencesToGenerate", () => {
  it("generates the first occurrence on the start date itself", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-05"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-01-05"),
    });
    expect(iso(out)).toEqual(["2026-01-05"]);
  });

  it("generates nothing before the first occurrence is due", () => {
    // Template starts 10 Jan but bills on the 15th — nothing is owed on the 12th.
    const out = occurrencesToGenerate({
      dayOfMonth: 15,
      startsOn: d("2026-01-10"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-01-12"),
    });
    expect(out).toEqual([]);
  });

  it("is a no-op when re-run the same day (the idempotency guarantee the cron relies on)", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-05"),
      endsOn: null,
      lastGeneratedFor: d("2026-01-05"),
      today: d("2026-01-05"),
    });
    expect(out).toEqual([]);
  });

  it("catches up every missed month after a gap in cron runs", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-05"),
      endsOn: null,
      lastGeneratedFor: d("2026-01-05"),
      today: d("2026-04-10"),
    });
    expect(iso(out)).toEqual(["2026-02-05", "2026-03-05", "2026-04-05"]);
  });

  it("catches up from a back-dated startsOn with nothing generated yet", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 1,
      startsOn: d("2025-11-01"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-02-15"),
    });
    expect(iso(out)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("skips the anchor month when its occurrence falls before startsOn", () => {
    // Signed up 20 Jan on a template that bills on the 5th: January's 5th already passed, so the
    // first real occurrence is February's. This is the case a naive "start at startsOn's month"
    // walk gets wrong by billing a month the tenant was never subscribed for.
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-20"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-03-10"),
    });
    expect(iso(out)).toEqual(["2026-02-05", "2026-03-05"]);
  });

  it("handles day 28 in February without rolling into March", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 28,
      startsOn: d("2026-01-28"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-03-28"),
    });
    expect(iso(out)).toEqual(["2026-01-28", "2026-02-28", "2026-03-28"]);
  });

  it("handles day 28 in a leap February", () => {
    // 2028 is a leap year — 28 Feb must still be 28 Feb, not 29 Feb or 1 Mar.
    const out = occurrencesToGenerate({
      dayOfMonth: 28,
      startsOn: d("2028-02-28"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2028-02-28"),
    });
    expect(iso(out)).toEqual(["2028-02-28"]);
  });

  it("stops at endsOn", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-05"),
      endsOn: d("2026-02-28"),
      lastGeneratedFor: null,
      today: d("2026-06-01"),
    });
    expect(iso(out)).toEqual(["2026-01-05", "2026-02-05"]);
  });

  it("generates nothing once endsOn has fully passed", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-05"),
      endsOn: d("2026-02-28"),
      lastGeneratedFor: d("2026-02-05"),
      today: d("2026-06-01"),
    });
    expect(out).toEqual([]);
  });

  it("crosses a year boundary correctly", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 15,
      startsOn: d("2026-11-15"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2027-02-20"),
    });
    expect(iso(out)).toEqual(["2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15"]);
  });

  it("ignores time-of-day on the inputs", () => {
    // `today` comes from `new Date()` in the cron and stored dates carry timestamps, so a template
    // due today must generate regardless of whether the clock says 00:01 or 23:59.
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: new Date("2026-01-05T18:30:00.000Z"),
      endsOn: null,
      lastGeneratedFor: null,
      today: new Date("2026-01-05T02:15:00.000Z"),
    });
    expect(iso(out)).toEqual(["2026-01-05"]);
  });

  it("never double-generates when lastGeneratedFor carries a time component", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 5,
      startsOn: d("2026-01-05"),
      endsOn: null,
      lastGeneratedFor: new Date("2026-01-05T23:59:59.000Z"),
      today: new Date("2026-01-05T06:00:00.000Z"),
    });
    expect(out).toEqual([]);
  });

  it("caps runaway catch-up at the 120-month scan limit", () => {
    // A template back-dated 30 years must not produce 360 rows or spin forever.
    const out = occurrencesToGenerate({
      dayOfMonth: 1,
      startsOn: d("1996-01-01"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-01-01"),
    });
    expect(out).toHaveLength(120);
    expect(iso(out)[0]).toBe("1996-01-01");
  });

  it("returns dates in ascending order", () => {
    const out = occurrencesToGenerate({
      dayOfMonth: 10,
      startsOn: d("2026-01-10"),
      endsOn: null,
      lastGeneratedFor: null,
      today: d("2026-05-10"),
    });
    const times = out.map((x) => x.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("rebaseLastGeneratedFor", () => {
  it("moves the marker forward when the billing day moves later in an already-billed month", () => {
    // Billed 1 Sep, day changed to the 15th — without rebasing, 15 Sep is still "owed" and
    // September gets billed twice.
    const out = rebaseLastGeneratedFor(d("2026-09-01"), 15);
    expect(out?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("leaves the marker alone when the new day is earlier in the month", () => {
    // Billed on the 20th, day moved to the 5th: 5 Sep is already in the past relative to the
    // marker, so occurrencesToGenerate skips it naturally and the next charge is 5 Oct.
    const out = rebaseLastGeneratedFor(d("2026-09-20"), 5);
    expect(out?.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("is a no-op when the day is unchanged", () => {
    const out = rebaseLastGeneratedFor(d("2026-09-10"), 10);
    expect(out?.toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("returns null when nothing has been generated yet", () => {
    expect(rebaseLastGeneratedFor(null, 15)).toBeNull();
  });

  it("prevents a double charge end-to-end when the day is moved later", () => {
    // The whole point, expressed as the two functions working together.
    const beforeRebase = occurrencesToGenerate({
      dayOfMonth: 15,
      startsOn: d("2026-09-01"),
      endsOn: null,
      lastGeneratedFor: d("2026-09-01"),
      today: d("2026-09-20"),
    });
    expect(iso(beforeRebase), "unrebased, September bills a second time").toEqual(["2026-09-15"]);

    const afterRebase = occurrencesToGenerate({
      dayOfMonth: 15,
      startsOn: d("2026-09-01"),
      endsOn: null,
      lastGeneratedFor: rebaseLastGeneratedFor(d("2026-09-01"), 15),
      today: d("2026-09-20"),
    });
    expect(afterRebase, "rebased, September is left alone").toEqual([]);

    // ...and October still bills on the new day.
    const october = occurrencesToGenerate({
      dayOfMonth: 15,
      startsOn: d("2026-09-01"),
      endsOn: null,
      lastGeneratedFor: rebaseLastGeneratedFor(d("2026-09-01"), 15),
      today: d("2026-10-20"),
    });
    expect(iso(october)).toEqual(["2026-10-15"]);
  });
});

describe("utcMidnight", () => {
  it("strips the time component", () => {
    expect(utcMidnight(new Date("2026-03-09T17:45:12.345Z")).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("is idempotent", () => {
    const once = utcMidnight(new Date("2026-03-09T17:45:12.345Z"));
    expect(utcMidnight(once).getTime()).toBe(once.getTime());
  });
});
