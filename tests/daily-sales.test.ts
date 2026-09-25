import { describe, expect, it } from "vitest";
import {
  capAtToday,
  dayEndsLabel,
  dayTitle,
  hourLabel,
  monthOf,
  periodTitle,
  shiftPeriod,
  weekOf,
} from "@/lib/daily-sales";

describe("weeks run Monday to Sunday", () => {
  it("finds the week from any day in it", () => {
    const week = { from: "2026-09-21", to: "2026-09-27" };
    expect(weekOf("2026-09-21")).toEqual(week); // Monday
    expect(weekOf("2026-09-25")).toEqual(week); // Friday
    expect(weekOf("2026-09-27")).toEqual(week); // Sunday — the end of its week, not the start of the next
  });

  it("crosses a month and a year", () => {
    expect(weekOf("2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(weekOf("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("steps a whole week back and forward", () => {
    const week = weekOf("2026-09-25");
    expect(shiftPeriod("week", week, -1)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(shiftPeriod("week", week, 1)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });
});

describe("months", () => {
  it("end on their own last day", () => {
    expect(monthOf("2026-09-25")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthOf("2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthOf("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); // leap year
    expect(monthOf("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("step across a year without skipping or repeating one", () => {
    expect(shiftPeriod("month", monthOf("2026-01-31"), -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(shiftPeriod("month", monthOf("2026-12-15"), 1)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    // From the 31st: a naive "same day next month" would land in March.
    expect(shiftPeriod("month", monthOf("2026-01-31"), 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("the period still under way", () => {
  it("stops at today, and a finished one is left alone", () => {
    expect(capAtToday(monthOf("2026-09-25"), "2026-09-25")).toEqual({ from: "2026-09-01", to: "2026-09-25" });
    expect(capAtToday(monthOf("2026-08-10"), "2026-09-25")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
});

describe("words on the screen", () => {
  it("names today and yesterday, and dates everything else", () => {
    expect(dayTitle("2026-09-25", "2026-09-25")).toBe("Today");
    expect(dayTitle("2026-09-24", "2026-09-25")).toBe("Yesterday");
    expect(dayTitle("2026-09-30", "2026-10-01")).toBe("Yesterday");
    expect(dayTitle("2024-02-14", "2026-09-25")).toBe("Wed 14 Feb 2024");
  });

  it("titles a period", () => {
    expect(periodTitle("week", weekOf("2026-09-25"))).toBe("21 – 27 Sep 2026");
    expect(periodTitle("week", weekOf("2026-10-01"))).toBe("28 Sep – 4 Oct 2026");
    expect(periodTitle("week", weekOf("2027-01-01"))).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(periodTitle("month", monthOf("2026-09-25"))).toBe("September 2026");
  });

  it("reads hours and the end of the day like a person would", () => {
    expect([0, 1, 11, 12, 13, 23].map(hourLabel)).toEqual(["12am", "1am", "11am", "12pm", "1pm", "11pm"]);
    expect(dayEndsLabel(0)).toBe("midnight");
    expect(dayEndsLabel(240)).toBe("4am");
    expect(dayEndsLabel(150)).toBe("2:30am");
  });
});
