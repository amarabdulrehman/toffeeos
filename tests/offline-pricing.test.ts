import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANCH_PRICING,
  computeProvisionalTotal,
  settingsForOrderType,
  type BranchPricingSnapshot,
} from "@/lib/pricing";

/**
 * The POS prices its cart by POSTing to /api/orders/preview. With the line down that request fails,
 * and until this was fixed the cart simply had no total: the cashier saw "Tax (0%)" and a total of
 * Rs 0 with a customer standing in front of them. The fix runs the same engine in the browser
 * against a snapshot of the branch's pricing config that ships with the page.
 *
 * What these tests protect is the part that can rot silently: the snapshot must resolve to the
 * *same* PricingSettings the server builds, or the cashier is shown one figure offline and the
 * customer is charged another when the order syncs. Both paths now go through
 * settingsForOrderType(), so what is pinned here is its behaviour and the defaults it falls back to.
 */

/** A branch configured the way a real Punjab café is: 17% GST on cash, 5% service charge dine-in. */
const snapshot: BranchPricingSnapshot = {
  serviceChargeBasisPoints: 500,
  serviceChargeAppliesTo: ["DINE_IN"],
  serviceChargeTaxable: true,
  roundingMode: "NEAREST_1",
  taxRules: [{ paymentMethods: [], rateBasisPoints: 1700, isActive: true }],
};

/** chai x3 @ Rs 100 — the cart from the offline screenshot that exposed this. */
const cart = [{ id: "0", unitPricePaisa: 10_000, quantity: 3 }];

function priceOffline(type: string) {
  return computeProvisionalTotal(cart, undefined, snapshot.taxRules, settingsForOrderType(snapshot, type));
}

describe("offline cart pricing", () => {
  it("produces a real total with no network, not Rs 0", () => {
    const totals = priceOffline("DINE_IN");

    // Rs 300 subtotal + Rs 15 service charge (5%) = Rs 315 taxable, + 17% tax = Rs 368.55 -> Rs 369.
    expect(totals.discountedSubtotalPaisa).toBe(30_000);
    expect(totals.serviceChargePaisa).toBe(1_500);
    expect(totals.taxableBasePaisa).toBe(31_500);
    expect(totals.taxPaisa).toBe(5_355);
    expect(totals.totalPaisa).toBe(36_900);

    // The bug, stated directly: these were what the cashier actually saw.
    expect(totals.totalPaisa, "a cashier must never be shown a total of zero").not.toBe(0);
    expect(totals.appliedRateBasisPoints, "tax rate must not collapse to 0%").toBe(1700);
  });

  it("applies the service charge only to the order types that attract it", () => {
    expect(settingsForOrderType(snapshot, "DINE_IN").serviceChargeApplies).toBe(true);
    expect(settingsForOrderType(snapshot, "TAKEAWAY").serviceChargeApplies).toBe(false);

    // Switching type after the page loaded must re-resolve, not reuse a baked-in answer.
    expect(priceOffline("TAKEAWAY").serviceChargePaisa).toBe(0);
    expect(priceOffline("TAKEAWAY").totalPaisa).toBe(35_100); // Rs 300 + 17% = Rs 351
    expect(priceOffline("DINE_IN").totalPaisa).toBe(36_900);
  });

  it("falls back to the same branch defaults the server uses", () => {
    // Pinned explicitly: these are the values an unconfigured branch gets on BOTH sides. If someone
    // changes one copy, the cashier sees a different total offline than the customer is charged.
    expect(DEFAULT_BRANCH_PRICING).toEqual({
      serviceChargeBasisPoints: 0,
      serviceChargeAppliesTo: ["DINE_IN"],
      serviceChargeTaxable: true,
      roundingMode: "NEAREST_1",
    });

    const unconfigured = settingsForOrderType(DEFAULT_BRANCH_PRICING, "DINE_IN");
    expect(unconfigured).toEqual({
      serviceChargeBasisPoints: 0,
      serviceChargeApplies: true,
      serviceChargeTaxable: true,
      roundingMode: "NEAREST_1",
    });
  });

  it("keeps a non-taxable service charge out of the taxable base", () => {
    const nonTaxable = { ...snapshot, serviceChargeTaxable: false };
    const totals = computeProvisionalTotal(
      cart,
      undefined,
      nonTaxable.taxRules,
      settingsForOrderType(nonTaxable, "DINE_IN")
    );
    expect(totals.taxableBasePaisa).toBe(30_000);
    expect(totals.taxPaisa).toBe(5_100);
  });

  it("prices a discounted cart the same way offline", () => {
    // value is BASIS POINTS, not percent — it goes through the same applyRate() as the tax rate.
    // Worth stating: the field is named `value`, so 10 reads like 10% and silently means 0.1%.
    const totals = computeProvisionalTotal(
      cart,
      { type: "PERCENT", value: 1000 },
      snapshot.taxRules,
      settingsForOrderType(snapshot, "DINE_IN")
    );
    expect(totals.discountedSubtotalPaisa).toBe(27_000);
    expect(totals.totalPaisa).toBeGreaterThan(0);
    expect(totals.totalPaisa).toBeLessThan(36_900);
  });
});
