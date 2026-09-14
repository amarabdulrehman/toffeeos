/**
 * All money in this codebase is an integer number of paisa (1/100 PKR). Never use `number` for
 * money in a way that involves fractional arithmetic, and never use `Decimal`/`Prisma.Decimal` in
 * application logic — paisa-as-integer is the whole strategy for avoiding float rounding bugs.
 *
 * All percentage/rate values are integer basis points: 1 bp = 0.01%, so 16.00% = 1600 bp.
 */

export type Paisa = number; // always an integer
export type BasisPoints = number; // always an integer, 10000 bp = 100%

const PAISA_PER_RUPEE = 100;

/** Guards against a caller accidentally passing a float or NaN into money math. */
export function assertInt(n: number, label: string): void {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${label} must be an integer, got ${n}`);
  }
}

/**
 * Multiplies a paisa amount by a basis-point rate, rounding half-up to the nearest paisa.
 * e.g. applyRate(133_33, 1600) => 16% of Rs 133.33 = Rs 21.33 (2133 paisa).
 */
export function applyRate(amountPaisa: Paisa, rateBasisPoints: BasisPoints): Paisa {
  assertInt(amountPaisa, "amountPaisa");
  assertInt(rateBasisPoints, "rateBasisPoints");
  return roundHalfUp((amountPaisa * rateBasisPoints) / 10_000);
}

/** Half-up rounding to the nearest integer, correct for negative numbers too (ties away from zero is not used — this is round-half-up toward +infinity, matching standard cash-register rounding). */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/**
 * Rounds a total to the nearest unit implied by `mode`, returning both the rounded total and the
 * adjustment applied (rounded - original), so callers can store the adjustment as its own line
 * and have the receipt reconcile exactly.
 */
export function roundTotal(
  totalPaisa: Paisa,
  mode: "NONE" | "NEAREST_1" | "NEAREST_5"
): { roundedPaisa: Paisa; adjustmentPaisa: Paisa } {
  assertInt(totalPaisa, "totalPaisa");
  if (mode === "NONE") return { roundedPaisa: totalPaisa, adjustmentPaisa: 0 };
  const unit = mode === "NEAREST_1" ? PAISA_PER_RUPEE : PAISA_PER_RUPEE * 5;
  const rounded = roundHalfUp(totalPaisa / unit) * unit;
  return { roundedPaisa: rounded, adjustmentPaisa: rounded - totalPaisa };
}

/**
 * Splits `totalPaisa` across `weights` proportionally, using the largest-remainder method so the
 * parts always sum EXACTLY back to totalPaisa (unlike naive per-part rounding, which can drift by
 * a paisa or two). Used for split-payment tax apportionment and for dividing a discount across
 * lines.
 *
 * weights must be non-negative; a weight of 0 always apportions to 0.
 */
export function apportion(totalPaisa: Paisa, weights: number[]): Paisa[] {
  assertInt(totalPaisa, "totalPaisa");
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0)) throw new Error("apportion weights must be non-negative");

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    // Nothing to weight by — dump it all on the first slot so the sum invariant still holds.
    return weights.map((_, i) => (i === 0 ? totalPaisa : 0));
  }

  const raw = weights.map((w) => (totalPaisa * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalPaisa - floors.reduce((a, b) => a + b, 0);

  // Distribute the leftover paisa one at a time to the entries with the largest fractional
  // remainder, so the result is both exact and as fair as possible.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k].i] += 1;
    remainder--;
  }
  return result;
}

export function paisaToRupees(paisa: Paisa): number {
  return paisa / PAISA_PER_RUPEE;
}

export function rupeesToPaisa(rupees: number): Paisa {
  return roundHalfUp(rupees * PAISA_PER_RUPEE);
}

/** Formats paisa as a PKR display string, e.g. formatPkr(123_456) => "Rs 1,234.56". */
export function formatPkr(paisa: Paisa, opts: { showPaisa?: boolean; locale?: string } = {}): string {
  const { showPaisa = false, locale = "en-PK" } = opts;
  const rupees = paisaToRupees(paisa);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: showPaisa ? 2 : 0,
    maximumFractionDigits: showPaisa ? 2 : 0,
  }).format(rupees);
  return `Rs ${formatted}`;
}

/**
 * Adds paisa, and refuses anything that is not paisa.
 *
 * The only function in this file that did not check its inputs, while applyRate, roundTotal and
 * apportion all do — and it is the one that produces the subtotal and the tax total in the pricing
 * engine. Every current caller passes integers, so this changes no behaviour today; it means a
 * future caller that passes a fraction fails at the point of the mistake instead of producing a
 * subtotal ending in .0000000004 that survives all the way to a receipt.
 */
export function sumPaisa(amounts: Paisa[]): Paisa {
  for (const a of amounts) assertInt(a, "sumPaisa amount");
  return amounts.reduce((a, b) => a + b, 0);
}

/**
 * Where an order stands on settlement, for the receipt's stamp.
 *
 * Kept here beside the other money helpers rather than inside the receipt component, because the
 * question "is this bill paid" is arithmetic, not presentation — and it is the arithmetic a
 * customer disputes. A function can be tested; a ternary buried in JSX cannot.
 *
 * Three states, because two would be a lie. A bill half-settled across cash and card is a real and
 * common thing in a restaurant, and a receipt that rounds it to either PAID or UNPAID is wrong in a
 * way that costs somebody money.
 *
 * Compares against the rounded total the customer is actually asked for, so a bill settled to the
 * rupee is not reported as underpaid by the rounding adjustment itself.
 */
export type PaymentStanding =
  | { state: "PAID"; balancePaisa: 0; changePaisa: Paisa }
  | { state: "PART_PAID"; balancePaisa: Paisa; changePaisa: 0 }
  | { state: "UNPAID"; balancePaisa: Paisa; changePaisa: 0 };

export function paymentStanding(totalPaisa: Paisa, paidPaisa: Paisa): PaymentStanding {
  assertInt(totalPaisa, "totalPaisa");
  assertInt(paidPaisa, "paidPaisa");

  if (paidPaisa >= totalPaisa) {
    // Tendering more than the bill is normal — a customer hands over a note and takes change. The
    // receipt should say so rather than silently swallowing the difference.
    return { state: "PAID", balancePaisa: 0, changePaisa: paidPaisa - totalPaisa };
  }
  if (paidPaisa > 0) {
    return { state: "PART_PAID", balancePaisa: totalPaisa - paidPaisa, changePaisa: 0 };
  }
  return { state: "UNPAID", balancePaisa: totalPaisa, changePaisa: 0 };
}
