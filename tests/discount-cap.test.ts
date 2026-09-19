import { describe, expect, it } from "vitest";
import { discountAmountPaisa, exceedsDiscountCap } from "@/lib/pricing";

/**
 * The discount ceiling.
 *
 * `pos.discount.exceedMax` sat in the roles registry from the beginning with no enforcement point
 * anywhere in the codebase, because there was no stored maximum to check a discount against. An
 * owner could deny the permission and still watch a cashier take 100% off a bill — the oldest way
 * a till leaks money, and the UI implied it was already handled.
 *
 * The arithmetic is here, pure and separate from the permission question, because it is where the
 * subtle failures live: a cap expressed in percent has to bind a FIXED rupee discount too, or it is
 * sidestepped by switching the discount type in the dropdown.
 */

const CAP_20 = 2_000; // 20%
const NO_CAP = 10_000; // 100%

describe("discountAmountPaisa", () => {
  it("matches what the pricing engine would actually take off", () => {
    expect(discountAmountPaisa(100_000, { type: "PERCENT", value: 1_000 })).toBe(10_000);
    expect(discountAmountPaisa(100_000, { type: "FIXED", value: 25_000 })).toBe(25_000);
    expect(discountAmountPaisa(100_000, undefined)).toBe(0);
  });

  it("never takes off more than the line is worth", () => {
    // The engine clamps, so the cap has to compare against the clamped figure or it would refuse a
    // discount that would in fact only have removed the whole line.
    expect(discountAmountPaisa(5_000, { type: "FIXED", value: 900_000 })).toBe(5_000);
    expect(discountAmountPaisa(5_000, { type: "PERCENT", value: 50_000 })).toBe(5_000);
  });
});

describe("exceedsDiscountCap", () => {
  it("allows anything when the cap is 100% or more", () => {
    expect(exceedsDiscountCap(100_000, { type: "PERCENT", value: 10_000 }, NO_CAP)).toBe(false);
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 100_000 }, NO_CAP)).toBe(false);
  });

  it("allows a discount exactly on the limit", () => {
    // Rs 200 off Rs 1,000 is precisely 20%. Refusing the boundary would make a 20% cap mean 19.99%,
    // and a manager who sets 20 expects to be able to give 20.
    expect(exceedsDiscountCap(100_000, { type: "PERCENT", value: 2_000 }, CAP_20)).toBe(false);
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 20_000 }, CAP_20)).toBe(false);
  });

  it("refuses a percentage over the limit", () => {
    expect(exceedsDiscountCap(100_000, { type: "PERCENT", value: 2_001 }, CAP_20)).toBe(true);
    expect(exceedsDiscountCap(100_000, { type: "PERCENT", value: 10_000 }, CAP_20)).toBe(true);
  });

  it("refuses a FIXED discount worth more than the limit, so the type cannot dodge the cap", () => {
    // The whole point. A 20% cap that only looked at PERCENT discounts would be defeated by typing
    // the same money into the rupees box instead.
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 20_001 }, CAP_20)).toBe(true);
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 100_000 }, CAP_20)).toBe(true);
  });

  it("treats no discount as within any cap", () => {
    expect(exceedsDiscountCap(100_000, undefined, 0)).toBe(false);
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 0 }, 0)).toBe(false);
  });

  it("refuses everything at a cap of zero", () => {
    expect(exceedsDiscountCap(100_000, { type: "PERCENT", value: 1 }, 0)).toBe(true);
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 1 }, 0)).toBe(true);
  });

  it("allows a discount on a worthless line, because none of it comes off", () => {
    // Worth stating explicitly: the first version of this guard refused these, reasoning that a
    // zero-value line cannot carry a percentage. But the engine clamps a discount to the amount, so
    // a free item absorbs nothing however large the discount asked for — there is no money to cap,
    // and refusing would block a legitimate "comp this free side" line.
    expect(discountAmountPaisa(0, { type: "FIXED", value: 900_000 })).toBe(0);
    expect(exceedsDiscountCap(0, { type: "FIXED", value: 900_000 }, CAP_20)).toBe(false);
    expect(exceedsDiscountCap(0, undefined, CAP_20)).toBe(false);
  });

  it("scales with the amount, not with a flat rupee figure", () => {
    // Rs 300 is fine on a Rs 5,000 bill and far too much on a Rs 1,000 one, at the same 20% cap.
    expect(exceedsDiscountCap(500_000, { type: "FIXED", value: 30_000 }, CAP_20)).toBe(false);
    expect(exceedsDiscountCap(100_000, { type: "FIXED", value: 30_000 }, CAP_20)).toBe(true);
  });
});
