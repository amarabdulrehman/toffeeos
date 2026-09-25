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

describe("a business day that ends after midnight", () => {
  // A café whose day ends at 4am. Karachi is UTC+5 all year.
  const TZ = "Asia/Karachi";
  const FOUR_AM = 4 * 60;

  it("keeps a 1:30am sale on the night it belongs to", () => {
    // 01:30 on the 11th in Karachi, which is 20:30 UTC on the 10th.
    const lateSale = new Date("2025-03-10T20:30:00Z");
    expect(businessDayOf(lateSale, TZ), "as a calendar day it is the 11th").toBe("2025-03-11");
    expect(businessDayOf(lateSale, TZ, FOUR_AM), "but the café is still trading the 10th").toBe("2025-03-10");
  });

  it("starts the new day at the configured hour, not a minute before", () => {
    expect(businessDayOf(new Date("2025-03-10T22:59:00Z"), TZ, FOUR_AM), "03:59 local").toBe("2025-03-10");
    expect(businessDayOf(new Date("2025-03-10T23:00:00Z"), TZ, FOUR_AM), "04:00 local").toBe("2025-03-11");
  });

  it("runs the day's range from 4am to just before the next 4am", () => {
    const { from, to } = businessDayRange("2025-03-10", TZ, FOUR_AM);
    expect(from.toISOString()).toBe("2025-03-09T23:00:00.000Z");
    expect(to.toISOString()).toBe("2025-03-10T22:59:59.999Z");
  });

  it("is exactly the calendar day when the day starts at midnight", () => {
    const { from, to } = businessDayRange("2025-03-10", TZ, 0);
    expect(from.toISOString()).toBe("2025-03-09T19:00:00.000Z");
    expect(to.toISOString()).toBe("2025-03-10T18:59:59.999Z");
  });

  it("stays right across a daylight-saving change", () => {
    // London springs forward at 01:00 UTC on 30 March 2025. With the day starting at 3am, 02:30
    // local on the 30th must still count as the 29th — subtracting three hours from the instant
    // would get this wrong on exactly that night.
    expect(businessDayOf(new Date("2025-03-30T01:30:00Z"), "Europe/London", 3 * 60)).toBe("2025-03-29");
    expect(businessDayOf(new Date("2025-03-30T02:00:00Z"), "Europe/London", 3 * 60)).toBe("2025-03-30");
  });

  it("carries today across midnight too", () => {
    expect(todayFor(TZ, new Date("2025-03-10T20:30:00Z"), FOUR_AM)).toBe("2025-03-10");
  });
});
