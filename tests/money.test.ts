import { describe, expect, it } from "vitest";
import { apportion, applyRate, formatPkr, paymentStanding, roundTotal, roundHalfUp } from "@/lib/money";

describe("roundHalfUp", () => {
  it("rounds .5 up, not banker's rounding", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(3.5)).toBe(4);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(2.6)).toBe(3);
  });
});

describe("applyRate", () => {
  it("computes 16% of Rs 133.33 correctly", () => {
    // 13333 paisa * 1600bp / 10000 = 2133.28 -> rounds to 2133
    expect(applyRate(13_333, 1600)).toBe(2133);
  });

  it("computes 5% split rate", () => {
    expect(applyRate(10_000, 500)).toBe(500);
  });

  it("returns 0 for a 0% rate", () => {
    expect(applyRate(999_999, 0)).toBe(0);
  });
});

describe("roundTotal", () => {
  it("NONE leaves the total untouched", () => {
    expect(roundTotal(123_456, "NONE")).toEqual({ roundedPaisa: 123_456, adjustmentPaisa: 0 });
  });

  it("NEAREST_1 rounds to the nearest rupee and reports the adjustment", () => {
    // Rs 123.49 -> Rs 123.00
    expect(roundTotal(12_349, "NEAREST_1")).toEqual({ roundedPaisa: 12_300, adjustmentPaisa: -49 });
    // Rs 123.50 -> Rs 124.00 (half-up)
    expect(roundTotal(12_350, "NEAREST_1")).toEqual({ roundedPaisa: 12_400, adjustmentPaisa: 50 });
  });

  it("NEAREST_5 rounds to the nearest 5 rupees", () => {
    // Rs 122.00 -> Rs 120.00 (rounds to nearest 500 paisa unit)
    expect(roundTotal(12_200, "NEAREST_5")).toEqual({ roundedPaisa: 12_000, adjustmentPaisa: -200 });
    expect(roundTotal(12_300, "NEAREST_5")).toEqual({ roundedPaisa: 12_500, adjustmentPaisa: 200 });
  });
});

describe("apportion", () => {
  it("splits a total exactly across weights that divide evenly", () => {
    expect(apportion(1000, [1, 1])).toEqual([500, 500]);
  });

  it("splits a total exactly even when it does NOT divide evenly, using largest remainder", () => {
    const parts = apportion(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    // 333.33 each -> two get 334? no: floor=333,333,333 remainder=1 -> one gets +1
    expect(parts.sort((a, b) => a - b)).toEqual([333, 333, 334]);
  });

  it("always sums exactly back to the total across many random splits", () => {
    for (let i = 0; i < 200; i++) {
      const total = Math.floor(Math.random() * 1_000_000);
      const weights = [Math.random() * 100, Math.random() * 100, Math.random() * 100];
      const parts = apportion(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("gives 0 to a 0-weight entry", () => {
    expect(apportion(1000, [1, 0])).toEqual([1000, 0]);
  });

  it("dumps everything on the first slot when all weights are 0", () => {
    expect(apportion(500, [0, 0, 0])).toEqual([500, 0, 0]);
  });

  it("returns [] for [] weights", () => {
    expect(apportion(500, [])).toEqual([]);
  });

  it("rejects negative weights", () => {
    expect(() => apportion(500, [1, -1])).toThrow();
  });
});

describe("formatPkr", () => {
  it("formats whole rupees with thousands separators", () => {
    expect(formatPkr(123_456_00)).toBe("Rs 123,456");
  });

  it("formats with paisa when requested", () => {
    expect(formatPkr(1234_56, { showPaisa: true })).toBe("Rs 1,234.56");
  });
});

describe("paymentStanding — what the receipt stamps on a bill", () => {
  it("settles exactly", () => {
    expect(paymentStanding(404_800, 404_800)).toEqual({ state: "PAID", balancePaisa: 0, changePaisa: 0 });
  });

  it("reports change when the customer tenders more than the bill", () => {
    // Rs 5,000 handed over against a Rs 4,048 bill — the receipt should say Rs 952 change,
    // not quietly absorb it.
    expect(paymentStanding(404_800, 500_000)).toEqual({ state: "PAID", balancePaisa: 0, changePaisa: 95_200 });
  });

  it("calls a half-settled bill part-paid, with the balance still owed", () => {
    const s = paymentStanding(404_800, 200_000);
    expect(s.state).toBe("PART_PAID");
    expect(s.balancePaisa).toBe(204_800);
  });

  it("treats a single paisa short as unsettled, not as paid", () => {
    // The whole point of the three-state model: rounding this to PAID is how a bill gets closed
    // with money still on the table.
    const s = paymentStanding(404_800, 404_799);
    expect(s.state).toBe("PART_PAID");
    expect(s.balancePaisa).toBe(1);
  });

  it("calls an untouched bill unpaid, owing the whole total", () => {
    expect(paymentStanding(404_800, 0)).toEqual({ state: "UNPAID", balancePaisa: 404_800, changePaisa: 0 });
  });

  it("refuses non-integer paisa rather than guessing", () => {
    expect(() => paymentStanding(404_800.5, 0)).toThrow();
    expect(() => paymentStanding(404_800, 1.5)).toThrow();
  });
});
