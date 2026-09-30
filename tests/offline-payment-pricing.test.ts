import { describe, it, expect } from "vitest";
import {
  finalizeOrder,
  pricingLinesFromStored,
  settingsForOrderType,
  type BranchPricingSnapshot,
  type TaxRuleInput,
} from "@/lib/pricing";

/**
 * Taking a card payment with the line down.
 *
 * The till used to refuse every method but cash offline, because only the server could price an
 * order at a method's own tax rate — a card taken at the stored cash-rate figure overcharged
 * (a Rs 284 card bill went through as Rs 305). The till now prices the order itself, so what is
 * pinned here is that "itself" and "the server" mean the same arithmetic: same engine, same line
 * builder, same inputs. If those ever diverge, the customer is charged one number while the screen
 * shows another, which is the failure this whole path exists to prevent.
 *
 * Punjab PRA's split is the real case: 16% on cash, 8% on card.
 */

const TAX_RULES: TaxRuleInput[] = [
  { rateBasisPoints: 1600, paymentMethods: ["CASH"] },
  { rateBasisPoints: 800, paymentMethods: ["CARD", "JAZZCASH", "EASYPAISA"] },
];

const SNAPSHOT: BranchPricingSnapshot = {
  serviceChargeBasisPoints: 0,
  serviceChargeAppliesTo: ["DINE_IN"],
  serviceChargeTaxable: true,
  roundingMode: "NEAREST_1",
  maxDiscountBasisPoints: 10000,
  taxRules: TAX_RULES,
};

/** The line shape the browser now has, straight off GET /api/orders. */
type StoredLine = {
  id: string;
  unitPricePaisa: number;
  quantity: number;
  isVoided: boolean;
  discountType: "PERCENT" | "FIXED" | null;
  discountValue: number | null;
};

const STORED_LINES: StoredLine[] = [
  { id: "l1", unitPricePaisa: 48_000, quantity: 1, isVoided: false, discountType: null, discountValue: null },
  { id: "l2", unitPricePaisa: 25_000, quantity: 2, isVoided: false, discountType: null, discountValue: null },
];

function priceAs(method: "CASH" | "CARD", lines: StoredLine[] = STORED_LINES, orderType = "DINE_IN", taxExempt = false) {
  return finalizeOrder(
    pricingLinesFromStored(lines),
    undefined,
    taxExempt ? [] : SNAPSHOT.taxRules,
    settingsForOrderType(SNAPSHOT, orderType),
    [{ method, amountPaisa: 0 }]
  );
}

describe("pricing a saved order on the device", () => {
  it("charges a card at the card rate, not the cash rate", () => {
    const cash = priceAs("CASH");
    const card = priceAs("CARD");

    // The bug in one assertion: these must not be the same number.
    expect(card.totalPaisa).not.toBe(cash.totalPaisa);
    expect(card.totalPaisa).toBeLessThan(cash.totalPaisa);

    // 980.00 subtotal: 16% cash, 8% card.
    expect(cash.taxPaisa).toBe(15_680);
    expect(card.taxPaisa).toBe(7_840);
  });

  it("never asks a card for the cash total, which is what overcharged before", () => {
    // Exactly the reported shape: the figure stored on the order is the cash-rate one, and taking
    // a card at it is an overcharge the server accepts, because it only refuses underpayment.
    const storedCashTotal = priceAs("CASH").totalPaisa;
    const trueCardTotal = priceAs("CARD").totalPaisa;
    expect(storedCashTotal - trueCardTotal).toBeGreaterThan(0);
  });

  it("keeps a line's own discount, so the device does not charge full price", () => {
    const discounted: StoredLine[] = [
      { id: "l1", unitPricePaisa: 48_000, quantity: 1, isVoided: false, discountType: "PERCENT", discountValue: 1000 },
      ...STORED_LINES.slice(1),
    ];
    expect(priceAs("CARD", discounted).totalPaisa).toBeLessThan(priceAs("CARD").totalPaisa);
  });

  it("leaves a voided line out", () => {
    const withVoid: StoredLine[] = [...STORED_LINES, { id: "l3", unitPricePaisa: 99_000, quantity: 1, isVoided: true, discountType: null, discountValue: null }];
    expect(priceAs("CARD", withVoid).totalPaisa).toBe(priceAs("CARD").totalPaisa);
  });

  it("charges no tax on an exempt order, whatever the method", () => {
    expect(priceAs("CARD", STORED_LINES, "DINE_IN", true).taxPaisa).toBe(0);
    expect(priceAs("CASH", STORED_LINES, "DINE_IN", true).taxPaisa).toBe(0);
  });

  it("applies the service charge by order type, not by whatever was selected at page load", () => {
    const snapshot = { ...SNAPSHOT, serviceChargeBasisPoints: 1000 };
    const dineIn = settingsForOrderType(snapshot, "DINE_IN");
    const takeaway = settingsForOrderType(snapshot, "TAKEAWAY");
    expect(dineIn.serviceChargeApplies).toBe(true);
    expect(takeaway.serviceChargeApplies).toBe(false);
  });

  it("splits across methods the same way the server does", () => {
    // A split bill is taxed pro-rata across its tenders, so half on card is not simply the cash
    // total halved. The point is only that the device produces one coherent answer.
    const split = finalizeOrder(
      pricingLinesFromStored(STORED_LINES),
      undefined,
      SNAPSHOT.taxRules,
      settingsForOrderType(SNAPSHOT, "DINE_IN"),
      [
        { method: "CASH", amountPaisa: 50_000 },
        { method: "CARD", amountPaisa: 50_000 },
      ]
    );
    expect(split.totalPaisa).toBeGreaterThan(priceAs("CARD").totalPaisa);
    expect(split.totalPaisa).toBeLessThan(priceAs("CASH").totalPaisa);
  });
});
