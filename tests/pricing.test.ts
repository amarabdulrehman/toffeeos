import { describe, expect, it } from "vitest";
import {
  applyOrderDiscount,
  computeChange,
  computeProvisionalTotal,
  computeServiceCharge,
  finalizeOrder,
  priceLines,
  resolveTaxRate,
  type PricingLineInput,
  type PricingSettings,
  type TaxRuleInput,
} from "@/lib/pricing";

// Punjab PRA split-rate: 16% cash, 8% card & digital — the default seed for the product.
const PUNJAB_TAX_RULES: TaxRuleInput[] = [
  { paymentMethods: ["CASH"], rateBasisPoints: 1600 },
  { paymentMethods: ["CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"], rateBasisPoints: 800 },
];

const BASE_SETTINGS: PricingSettings = {
  serviceChargeBasisPoints: 1000, // 10%
  serviceChargeApplies: true,
  serviceChargeTaxable: true,
  roundingMode: "NEAREST_1",
};

describe("priceLines", () => {
  it("multiplies unit price by quantity", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 25_000, quantity: 2 }];
    const { subtotalPaisa } = priceLines(lines);
    expect(subtotalPaisa).toBe(50_000);
  });

  it("applies a percent line discount", () => {
    const lines: PricingLineInput[] = [
      { id: "a", unitPricePaisa: 10_000, quantity: 1, discount: { type: "PERCENT", value: 1000 } }, // 10%
    ];
    const { results } = priceLines(lines);
    expect(results[0]).toEqual({ id: "a", grossPaisa: 10_000, discountPaisa: 1000, netPaisa: 9000 });
  });

  it("applies a fixed line discount", () => {
    const lines: PricingLineInput[] = [
      { id: "a", unitPricePaisa: 10_000, quantity: 1, discount: { type: "FIXED", value: 2000 } },
    ];
    const { results } = priceLines(lines);
    expect(results[0].netPaisa).toBe(8000);
  });

  it("clamps a 100% (and beyond) discount at zero, never negative", () => {
    const lines: PricingLineInput[] = [
      { id: "a", unitPricePaisa: 10_000, quantity: 1, discount: { type: "PERCENT", value: 10_000 } },
      { id: "b", unitPricePaisa: 10_000, quantity: 1, discount: { type: "FIXED", value: 99_999 } },
    ];
    const { results, subtotalPaisa } = priceLines(lines);
    expect(results[0].netPaisa).toBe(0);
    expect(results[1].netPaisa).toBe(0);
    expect(subtotalPaisa).toBe(0);
  });

  it("excludes voided lines entirely from the subtotal", () => {
    const lines: PricingLineInput[] = [
      { id: "a", unitPricePaisa: 10_000, quantity: 1 },
      { id: "b", unitPricePaisa: 50_000, quantity: 3, isVoided: true },
    ];
    const { subtotalPaisa, results } = priceLines(lines);
    expect(subtotalPaisa).toBe(10_000);
    expect(results[1]).toEqual({ id: "b", grossPaisa: 0, discountPaisa: 0, netPaisa: 0 });
  });
});

describe("applyOrderDiscount", () => {
  it("clamps an order-level discount at the subtotal, never negative", () => {
    expect(applyOrderDiscount(5000, { type: "FIXED", value: 999_999 })).toEqual({
      discountPaisa: 5000,
      discountedSubtotalPaisa: 0,
    });
  });

  it("passes the subtotal through unchanged with no discount", () => {
    expect(applyOrderDiscount(5000, undefined)).toEqual({
      discountPaisa: 0,
      discountedSubtotalPaisa: 5000,
    });
  });
});

describe("computeServiceCharge", () => {
  it("is zero when the order type doesn't get service charge (e.g. takeaway)", () => {
    expect(computeServiceCharge(100_000, { ...BASE_SETTINGS, serviceChargeApplies: false })).toBe(0);
  });

  it("computes the configured percentage when it applies", () => {
    expect(computeServiceCharge(100_000, BASE_SETTINGS)).toBe(10_000); // 10% of Rs 1000
  });
});

describe("resolveTaxRate", () => {
  it("picks the Punjab PRA cash rate for CASH", () => {
    expect(resolveTaxRate(PUNJAB_TAX_RULES, "CASH")).toBe(1600);
  });

  it("picks the Punjab PRA digital rate for CARD", () => {
    expect(resolveTaxRate(PUNJAB_TAX_RULES, "CARD")).toBe(800);
  });

  it("falls back to a catch-all rule when present", () => {
    const rules: TaxRuleInput[] = [{ paymentMethods: [], rateBasisPoints: 1500 }];
    expect(resolveTaxRate(rules, "JAZZCASH")).toBe(1500);
  });

  it("returns 0 (zero-tax branch) when no rule matches at all", () => {
    expect(resolveTaxRate([], "CASH")).toBe(0);
  });

  it("ignores inactive rules", () => {
    const rules: TaxRuleInput[] = [{ paymentMethods: ["CASH"], rateBasisPoints: 1600, isActive: false }];
    expect(resolveTaxRate(rules, "CASH")).toBe(0);
  });
});

describe("computeProvisionalTotal", () => {
  it("assumes cash (the higher Punjab rate) by default", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 1 }];
    const totals = computeProvisionalTotal(lines, undefined, PUNJAB_TAX_RULES, {
      ...BASE_SETTINGS,
      serviceChargeApplies: false,
    });
    expect(totals.appliedRateBasisPoints).toBe(1600);
    expect(totals.taxPaisa).toBe(16_000); // 16% of Rs 1000
    expect(totals.totalPaisa).toBe(116_000);
  });

  it("chains discount -> service charge -> tax in the documented order", () => {
    // Rs 1000 subtotal, 20% order discount -> Rs 800, 10% service charge -> Rs 80,
    // taxable base (service charge taxable) = Rs 880, 16% cash tax = Rs 140.80 -> 141 (round half up)
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 1 }];
    const totals = computeProvisionalTotal(
      lines,
      { type: "PERCENT", value: 2000 },
      PUNJAB_TAX_RULES,
      BASE_SETTINGS
    );
    expect(totals.discountedSubtotalPaisa).toBe(80_000);
    expect(totals.serviceChargePaisa).toBe(8000);
    expect(totals.taxableBasePaisa).toBe(88_000);
    expect(totals.taxPaisa).toBe(14_080); // 16% of 88000 exactly
    // preRoundingTotalPaisa is the raw chain (80_000 + 8000 + 14_080 = 102_080, i.e. Rs 1020.80);
    // computeProvisionalTotal rounds this per the branch's mode (step 9 of the file's documented
    // order of operations), same as finalizeOrder — this used to be skipped here, a real bug: the
    // amount shown/persisted at order-creation time could be a few paisa off from what
    // finalizeOrder would require at payment time, tripping the underpayment guard on the exact
    // amount the UI itself had just defaulted the cashier to.
    expect(totals.preRoundingTotalPaisa).toBe(80_000 + 8000 + 14_080);
    expect(totals.roundingAdjustmentPaisa).toBe(20); // 102_080 -> nearest rupee is 102_100
    expect(totals.totalPaisa).toBe(102_100);
  });

  it("excludes service charge from the taxable base when serviceChargeTaxable is false", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 1 }];
    const totals = computeProvisionalTotal(lines, undefined, PUNJAB_TAX_RULES, {
      ...BASE_SETTINGS,
      serviceChargeTaxable: false,
    });
    expect(totals.taxableBasePaisa).toBe(100_000); // service charge (10_000) excluded
    expect(totals.taxPaisa).toBe(16_000);
  });
});

describe("finalizeOrder — split payments and split-rate tax", () => {
  it("charges a single tender at that tender's own rate", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 1 }];
    const result = finalizeOrder(
      lines,
      undefined,
      PUNJAB_TAX_RULES,
      { ...BASE_SETTINGS, serviceChargeApplies: false },
      [{ method: "CARD", amountPaisa: 108_000 }]
    );
    expect(result.tenders[0].rateBasisPoints).toBe(800);
    expect(result.taxPaisa).toBe(8000); // 8% of 100_000
    expect(result.totalPaisa).toBe(108_000);
  });

  it("blends the rate across a cash+card split, apportioning the taxable base by tender amount", () => {
    // Rs 1000 taxable base, split 600/400 between cash (16%) and card (8%).
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 1 }];
    const settings: PricingSettings = { ...BASE_SETTINGS, serviceChargeApplies: false };
    const result = finalizeOrder(lines, undefined, PUNJAB_TAX_RULES, settings, [
      { method: "CASH", amountPaisa: 60_000 },
      { method: "CARD", amountPaisa: 40_000 },
    ]);
    // base apportioned 600/400 (weights = tender amounts, same ratio) => 60_000 / 40_000 exactly
    expect(result.tenders[0].taxableBasePaisa + result.tenders[1].taxableBasePaisa).toBe(100_000);
    expect(result.tenders[0].taxPaisa).toBe(9600); // 16% of 60_000
    expect(result.tenders[1].taxPaisa).toBe(3200); // 8% of 40_000
    expect(result.taxPaisa).toBe(12_800);
  });

  it("apportions the taxable base across an uneven 3-way split with slices summing exactly", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 333_00, quantity: 1 }]; // Rs 333.00
    const settings: PricingSettings = { ...BASE_SETTINGS, serviceChargeApplies: false };
    const result = finalizeOrder(lines, undefined, PUNJAB_TAX_RULES, settings, [
      { method: "CASH", amountPaisa: 111_00 },
      { method: "CARD", amountPaisa: 111_00 },
      { method: "JAZZCASH", amountPaisa: 111_00 },
    ]);
    const sumOfSlices = result.tenders.reduce((a, t) => a + t.taxableBasePaisa, 0);
    expect(sumOfSlices).toBe(33_300);
  });

  it("rounds the final total per NEAREST_1 and reports the adjustment", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_49, quantity: 1 }]; // Rs 100.49
    const settings: PricingSettings = { ...BASE_SETTINGS, serviceChargeApplies: false, roundingMode: "NEAREST_1" };
    const result = finalizeOrder(lines, undefined, [], settings, [{ method: "CASH", amountPaisa: 100_49 }]);
    expect(result.preRoundingTotalPaisa).toBe(100_49);
    expect(result.totalPaisa).toBe(100_00);
    expect(result.roundingAdjustmentPaisa).toBe(-49);
  });

  it("charges zero tax on a branch with no tax rules configured", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 1 }];
    const settings: PricingSettings = { ...BASE_SETTINGS, serviceChargeApplies: false, roundingMode: "NONE" };
    const result = finalizeOrder(lines, undefined, [], settings, [{ method: "CASH", amountPaisa: 100_000 }]);
    expect(result.taxPaisa).toBe(0);
    expect(result.totalPaisa).toBe(100_000);
  });

  it("handles a fully voided/negative-net order (all lines voided) without throwing or going negative", () => {
    const lines: PricingLineInput[] = [{ id: "a", unitPricePaisa: 100_000, quantity: 2, isVoided: true }];
    const settings: PricingSettings = { ...BASE_SETTINGS, serviceChargeApplies: false, roundingMode: "NONE" };
    const result = finalizeOrder(lines, undefined, PUNJAB_TAX_RULES, settings, [{ method: "CASH", amountPaisa: 0 }]);
    expect(result.subtotalPaisa).toBe(0);
    expect(result.totalPaisa).toBe(0);
    expect(result.taxPaisa).toBe(0);
  });

  it("end-to-end: full dine-in order with line discount, order discount, service charge, split payment, rounding", () => {
    const lines: PricingLineInput[] = [
      { id: "a", unitPricePaisa: 45_000, quantity: 2 }, // 90,000
      { id: "b", unitPricePaisa: 12_500, quantity: 3, discount: { type: "PERCENT", value: 500 } }, // 37500 - 5% = 35625
    ];
    const settings: PricingSettings = {
      serviceChargeBasisPoints: 500, // 5%
      serviceChargeApplies: true,
      serviceChargeTaxable: true,
      roundingMode: "NEAREST_1",
    };
    const result = finalizeOrder(lines, { type: "FIXED", value: 5000 }, PUNJAB_TAX_RULES, settings, [
      { method: "CASH", amountPaisa: 80_000 },
      { method: "JAZZCASH", amountPaisa: 60_000 },
    ]);
    // subtotal = 90000 + 35625 = 125625; -5000 order discount = 120625
    expect(result.subtotalPaisa).toBe(125_625);
    expect(result.discountedSubtotalPaisa).toBe(120_625);
    // service charge 5% of 120625 = 6031.25 -> 6031
    expect(result.serviceChargePaisa).toBe(6031);
    // taxable base = 120625 + 6031 = 126656
    expect(result.taxableBasePaisa).toBe(126_656);
    // tenders sum to 140000; slices must sum back to 126656 exactly
    const sliceSum = result.tenders.reduce((a, t) => a + t.taxableBasePaisa, 0);
    expect(sliceSum).toBe(126_656);
    // total is internally consistent
    expect(result.preRoundingTotalPaisa).toBe(
      result.discountedSubtotalPaisa + result.serviceChargePaisa + result.taxPaisa + result.deliveryFeePaisa
    );
  });
});

describe("computeChange", () => {
  it("computes cash-back for an over-tender", () => {
    expect(computeChange(1000, 850)).toBe(150);
  });

  it("clamps at zero for an under-tender rather than going negative", () => {
    expect(computeChange(500, 850)).toBe(0);
  });
});
