import { describe, it, expect } from "vitest";
import { businessDayOf, businessDayRange, isBusinessDay, todayFor } from "@/lib/business-day";

/**
 * The business day is the foundation the cash drawer sits on: get the boundary wrong and a night
 * shift's takings land on the wrong day's drawer, producing a variance nobody can explain. This
 * codebase has already shipped two silent timezone bugs (Expense.spentAt, User.sessionsValidFrom),
 * both from treating a local wall-clock moment as a UTC one, so the boundaries get pinned here.
 */

const KHI = "Asia/Karachi"; // UTC+5, no DST — the default for every branch
const NYC = "America/New_York"; // has DST, which is where the interesting cases live

describe("businessDayOf", () => {
  it("uses the branch's timezone, not UTC", () => {
    // 20:00 UTC on the 6th is already 01:00 on the 7th in Karachi.
    const instant = new Date("2026-09-06T20:00:00.000Z");
    expect(businessDayOf(instant, KHI)).toBe("2026-09-07");
    expect(businessDayOf(instant, "UTC")).toBe("2026-09-06");
  });

  it("keeps a late-night shift on the day it started", () => {
    // 01:30 Karachi time on the 8th, i.e. a restaurant still serving after midnight. This is the
    // case the drawer cares about: it is a new calendar day, and the code must say so rather than
    // silently rolling takings into the previous one.
    const instant = new Date("2026-09-07T20:30:00.000Z");
    expect(businessDayOf(instant, KHI)).toBe("2026-09-08");
  });
});

describe("businessDayRange", () => {
  it("spans the full local day as real UTC instants", () => {
    const { from, to } = businessDayRange("2026-09-07", KHI);
    // Karachi is UTC+5, so local midnight is 19:00 UTC the day before.
    expect(from.toISOString()).toBe("2026-09-06T19:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-07T18:59:59.999Z");
  });

  it("covers exactly 24 hours with no gap between consecutive days", () => {
    const day1 = businessDayRange("2026-09-07", KHI);
    const day2 = businessDayRange("2026-09-08", KHI);
    // One millisecond apart — an order timestamped in between must belong to exactly one of them.
    expect(day2.from.getTime() - day1.to.getTime()).toBe(1);
  });

  it("handles a DST transition without losing or double-counting an hour", () => {
    // 8 March 2026, when New York springs forward: the local day is 23 hours long. A naive
    // "midnight plus 24 hours" would spill an hour into the next business day.
    const { from, to } = businessDayRange("2026-03-08", NYC);
    const hours = (to.getTime() - from.getTime() + 1) / 3_600_000;
    expect(hours).toBe(23);
  });

  it("round-trips: every instant in a day's range reports that day", () => {
    const day = "2026-09-07";
    const { from, to } = businessDayRange(day, KHI);
    expect(businessDayOf(from, KHI)).toBe(day);
    expect(businessDayOf(to, KHI)).toBe(day);
    expect(businessDayOf(new Date(from.getTime() - 1), KHI)).not.toBe(day);
    expect(businessDayOf(new Date(to.getTime() + 1), KHI)).not.toBe(day);
  });
});

describe("isBusinessDay", () => {
  it("accepts a real date", () => {
    expect(isBusinessDay("2026-09-07")).toBe(true);
    expect(isBusinessDay("2024-02-29")).toBe(true); // a real leap day
  });

  it("rejects anything that isn't one", () => {
    // The string reaches a unique key and a query, so shape alone is not enough.
    expect(isBusinessDay("2026-02-31")).toBe(false); // right shape, no such day
    expect(isBusinessDay("2025-02-29")).toBe(false); // not a leap year
    expect(isBusinessDay("2026-13-01")).toBe(false);
    expect(isBusinessDay("7-9-2026")).toBe(false);
    expect(isBusinessDay("2026-09-07T00:00:00Z")).toBe(false);
    expect(isBusinessDay("")).toBe(false);
  });
});

describe("todayFor", () => {
  it("reports the branch's today, not the server's", () => {
    const now = new Date("2026-09-06T21:00:00.000Z"); // already the 7th in Karachi
    expect(todayFor(KHI, now)).toBe("2026-09-07");
    expect(todayFor("UTC", now)).toBe("2026-09-06");
  });
});
