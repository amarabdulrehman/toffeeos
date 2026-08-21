/**
 * Pure order-pricing engine. No I/O, no Prisma import, no React — this file only does arithmetic
 * so it can be unit tested exhaustively (see tests/pricing.test.ts) and reused identically by the
 * POS cart, the offline queue replay, and the server-side order finalization endpoint.
 *
 * Fixed order of operations (do not reorder without updating the plan doc and the tests):
 *   1. lineGross = (unitPrice, which already bakes in variant + modifier deltas) × qty
 *   2. line discount (% or fixed) -> lineNet
 *   3. subtotal = sum(lineNet)
 *   4. order-level discount -> discountedSubtotal
 *   5. serviceCharge = discountedSubtotal × pct, only if the order type gets service charge
 *   6. taxableBase = discountedSubtotal + (serviceChargeTaxable ? serviceCharge : 0)
 *   7. tax = taxableBase × effectiveRate(paymentMethod) — see resolveTaxRate()
 *   8. total = discountedSubtotal + serviceCharge + tax + deliveryFee
 *   9. round total per branch rounding mode; store the adjustment as its own field
 *
 * Punjab PRA split-rate subtlety: tax rate depends on payment method, but payment is chosen after
 * the cart is built. computeProvisionalTotal() shows a running total at a single assumed rate
 * (cash by default) while the cart is open. finalizeOrder() is the authoritative computation once
 * tenders are known: it apportions the taxable base across tenders pro-rata by tendered amount
 * (largest-remainder, via apportion()), taxes each slice at its own tender's resolved rate, and
 * sums — so a cash+card split order pays a genuinely blended rate, not one rate for everything.
 */

import { apportion, applyRate, assertInt, roundTotal, sumPaisa, type BasisPoints, type Paisa } from "./money";

export type PaymentMethodKey = "CASH" | "CARD" | "JAZZCASH" | "EASYPAISA" | "BANK_TRANSFER" | "OTHER";
export type DiscountTypeKey = "PERCENT" | "FIXED";
export type RoundingModeKey = "NONE" | "NEAREST_1" | "NEAREST_5";

/** value is basis points for PERCENT (10% = 1000), paisa for FIXED. */
export interface DiscountInput {
  type: DiscountTypeKey;
  value: number;
}

export interface PricingLineInput {
  id: string;
  /** Per-unit price, already including variant delta + sum of modifier deltas. */
  unitPricePaisa: Paisa;
  quantity: number;
  discount?: DiscountInput;
  isVoided?: boolean;
}

export interface LineResult {
  id: string;
  grossPaisa: Paisa;
  discountPaisa: Paisa;
  netPaisa: Paisa;
}

export interface TaxRuleInput {
  /** Empty array matches every payment method. */
  paymentMethods: PaymentMethodKey[];
  rateBasisPoints: BasisPoints;
  isActive?: boolean;
}

export interface PricingSettings {
  serviceChargeBasisPoints: BasisPoints;
  /** Resolved by the caller from BranchSettings.serviceChargeAppliesTo + the order's type. */
  serviceChargeApplies: boolean;
  serviceChargeTaxable: boolean;
  roundingMode: RoundingModeKey;
  deliveryFeePaisa?: Paisa;
}

/** Applies a line-level discount, clamped so a line can never go negative. */
function applyLineDiscount(grossPaisa: Paisa, discount: DiscountInput | undefined): {
  discountPaisa: Paisa;
  netPaisa: Paisa;
} {
  if (!discount) return { discountPaisa: 0, netPaisa: grossPaisa };
  const raw = discount.type === "PERCENT" ? applyRate(grossPaisa, discount.value) : discount.value;
  const discountPaisa = Math.max(0, Math.min(raw, grossPaisa));
  return { discountPaisa, netPaisa: grossPaisa - discountPaisa };
}

export function priceLines(lines: PricingLineInput[]): { results: LineResult[]; subtotalPaisa: Paisa } {
  const results: LineResult[] = lines.map((line) => {
    assertInt(line.unitPricePaisa, `line[${line.id}].unitPricePaisa`);
    assertInt(line.quantity, `line[${line.id}].quantity`);
    if (line.isVoided) {
      return { id: line.id, grossPaisa: 0, discountPaisa: 0, netPaisa: 0 };
    }
    const grossPaisa = line.unitPricePaisa * line.quantity;
    const { discountPaisa, netPaisa } = applyLineDiscount(grossPaisa, line.discount);
    return { id: line.id, grossPaisa, discountPaisa, netPaisa };
  });
  return { results, subtotalPaisa: sumPaisa(results.map((r) => r.netPaisa)) };
}

/** Applies an order-level discount on top of the line-discounted subtotal, clamped at zero. */
export function applyOrderDiscount(subtotalPaisa: Paisa, discount: DiscountInput | undefined): {
  discountPaisa: Paisa;
  discountedSubtotalPaisa: Paisa;
} {
  if (!discount) return { discountPaisa: 0, discountedSubtotalPaisa: subtotalPaisa };
  const raw = discount.type === "PERCENT" ? applyRate(subtotalPaisa, discount.value) : discount.value;
  const discountPaisa = Math.max(0, Math.min(raw, subtotalPaisa));
  return { discountPaisa, discountedSubtotalPaisa: subtotalPaisa - discountPaisa };
}

export function computeServiceCharge(discountedSubtotalPaisa: Paisa, settings: PricingSettings): Paisa {
  if (!settings.serviceChargeApplies) return 0;
  return applyRate(discountedSubtotalPaisa, settings.serviceChargeBasisPoints);
}

/**
 * Picks the tax rule matching `method`, preferring the most specific match (a rule naming this
 * exact method beats a catch-all rule with an empty paymentMethods array). Falls back to 0 bp if
 * nothing matches, rather than throwing — an unconfigured branch should charge no tax, not crash
 * the POS.
 *
 * Phase 1 only supports "the currently active rules" — TaxRule.effectiveFrom/effectiveTo exist in
 * the schema for future date-versioned tax changes (e.g. a provincial rate change effective a
 * known date) but aren't consulted here yet; callers only pass in currently-active rows.
 */
export function resolveTaxRate(taxRules: TaxRuleInput[], method: PaymentMethodKey): BasisPoints {
  const active = taxRules.filter((r) => r.isActive !== false);
  const specific = active.find((r) => r.paymentMethods.includes(method));
  if (specific) return specific.rateBasisPoints;
  const catchAll = active.find((r) => r.paymentMethods.length === 0);
  return catchAll ? catchAll.rateBasisPoints : 0;
}

export interface ProvisionalTotals {
  subtotalPaisa: Paisa;
  discountedSubtotalPaisa: Paisa;
  serviceChargePaisa: Paisa;
  taxableBasePaisa: Paisa;
  taxPaisa: Paisa;
  deliveryFeePaisa: Paisa;
  preRoundingTotalPaisa: Paisa;
  roundingAdjustmentPaisa: Paisa;
  totalPaisa: Paisa;
  appliedRateBasisPoints: BasisPoints;
}

/**
 * Cart-building display total, computed at a single assumed payment method (cash by default,
 * since that's the higher Punjab PRA rate and the safer thing to show before payment is chosen).
 * Not rounded — this is a live-updating figure, not a receipt.
 */
export function computeProvisionalTotal(
  lines: PricingLineInput[],
  orderDiscount: DiscountInput | undefined,
  taxRules: TaxRuleInput[],
  settings: PricingSettings,
  assumedMethod: PaymentMethodKey = "CASH"
): ProvisionalTotals {
  const { subtotalPaisa } = priceLines(lines);
  const { discountedSubtotalPaisa } = applyOrderDiscount(subtotalPaisa, orderDiscount);
  const serviceChargePaisa = computeServiceCharge(discountedSubtotalPaisa, settings);
  const taxableBasePaisa = discountedSubtotalPaisa + (settings.serviceChargeTaxable ? serviceChargePaisa : 0);
  const appliedRateBasisPoints = resolveTaxRate(taxRules, assumedMethod);
  const taxPaisa = applyRate(taxableBasePaisa, appliedRateBasisPoints);
  const deliveryFeePaisa = settings.deliveryFeePaisa ?? 0;
  const preRoundingTotalPaisa = discountedSubtotalPaisa + serviceChargePaisa + taxPaisa + deliveryFeePaisa;
  // Step 9 of the file-level order-of-operations doc comment applies here too, not just in
  // finalizeOrder — this was a real bug: the provisional total (what gets persisted as
  // Order.totalPaisa at creation, and what the POS cart/payment dialog display and default the
  // cash tender to) never rounded, so it could land on the wrong side of takePayment's
  // underpayment guard by the rounding adjustment itself for the extremely common case of a
  // single-method order (assumedMethod already matches the actual tender). Rounding here now
  // matches finalizeOrder's authoritative rounding for that case, so the amount a cashier is
  // shown/defaulted to is always payable.
  const { roundedPaisa, adjustmentPaisa } = roundTotal(preRoundingTotalPaisa, settings.roundingMode);
  return {
    subtotalPaisa,
    discountedSubtotalPaisa,
    serviceChargePaisa,
    taxableBasePaisa,
    taxPaisa,
    deliveryFeePaisa,
    preRoundingTotalPaisa,
    roundingAdjustmentPaisa: adjustmentPaisa,
    totalPaisa: roundedPaisa,
    appliedRateBasisPoints,
  };
}

export interface TenderInput {
  method: PaymentMethodKey;
  amountPaisa: Paisa;
}

export interface TenderResult extends TenderInput {
  taxableBasePaisa: Paisa;
  taxPaisa: Paisa;
  rateBasisPoints: BasisPoints;
}

export interface FinalTotals {
  subtotalPaisa: Paisa;
  discountedSubtotalPaisa: Paisa;
  serviceChargePaisa: Paisa;
  taxableBasePaisa: Paisa;
  taxPaisa: Paisa;
  deliveryFeePaisa: Paisa;
  preRoundingTotalPaisa: Paisa;
  roundingAdjustmentPaisa: Paisa;
  totalPaisa: Paisa;
  tenders: TenderResult[];
}

/**
 * Authoritative computation once tenders are known. Apportions the taxable base across tenders
 * pro-rata by tendered amount (via apportion(), so the slices sum exactly), taxes each slice at
 * its own method's resolved rate, and rounds the grand total per the branch's rounding mode.
 *
 * tenders must sum to the order's intended total (validated by the caller/API layer, not here —
 * this function is pure and does not know what a "valid" split looks like beyond the arithmetic).
 */
export function finalizeOrder(
  lines: PricingLineInput[],
  orderDiscount: DiscountInput | undefined,
  taxRules: TaxRuleInput[],
  settings: PricingSettings,
  tenders: TenderInput[]
): FinalTotals {
  const { subtotalPaisa } = priceLines(lines);
  const { discountedSubtotalPaisa } = applyOrderDiscount(subtotalPaisa, orderDiscount);
  const serviceChargePaisa = computeServiceCharge(discountedSubtotalPaisa, settings);
  const taxableBasePaisa = discountedSubtotalPaisa + (settings.serviceChargeTaxable ? serviceChargePaisa : 0);
  const deliveryFeePaisa = settings.deliveryFeePaisa ?? 0;

  const weights = tenders.map((t) => t.amountPaisa);
  const baseSlices = apportion(taxableBasePaisa, weights);
  const tenderResults: TenderResult[] = tenders.map((t, i) => {
    const rateBasisPoints = resolveTaxRate(taxRules, t.method);
    return {
      ...t,
      taxableBasePaisa: baseSlices[i],
      taxPaisa: applyRate(baseSlices[i], rateBasisPoints),
      rateBasisPoints,
    };
  });

  const taxPaisa = sumPaisa(tenderResults.map((t) => t.taxPaisa));
  const preRoundingTotalPaisa = discountedSubtotalPaisa + serviceChargePaisa + taxPaisa + deliveryFeePaisa;
  const { roundedPaisa, adjustmentPaisa } = roundTotal(preRoundingTotalPaisa, settings.roundingMode);

  return {
    subtotalPaisa,
    discountedSubtotalPaisa,
    serviceChargePaisa,
    taxableBasePaisa,
    taxPaisa,
    deliveryFeePaisa,
    preRoundingTotalPaisa,
    roundingAdjustmentPaisa: adjustmentPaisa,
    totalPaisa: roundedPaisa,
    tenders: tenderResults,
  };
}

/** Cash-back due, clamped at zero (never negative even if the cashier under-tenders). */
export function computeChange(tenderedPaisa: Paisa, amountDuePaisa: Paisa): Paisa {
  return Math.max(0, tenderedPaisa - amountDuePaisa);
}
