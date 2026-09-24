import type { PaymentMethodKey } from "@/lib/pricing";

/**
 * The shape of a pre-payment bill, shared by the server that prices it (src/server/bill.ts) and the
 * slip that prints it (src/components/pos/receipt.tsx). Types only, so the client can use them
 * without pulling in anything server-side.
 */

export interface BillOption {
  methods: PaymentMethodKey[];
  taxPaisa: number;
  /** The rate as printed, e.g. 16. Whole percent is what PRA rates are. */
  taxRatePct: number;
  roundingAdjustmentPaisa: number;
  totalPaisa: number;
}

export interface OrderBill {
  /** The printed lines' own sum, before any discount. */
  subtotalPaisa: number;
  /** Every discount together — per line and on the whole order. */
  discountPaisa: number;
  serviceChargePaisa: number;
  deliveryFeePaisa: number;
  /** One entry per distinct total, cheapest first — the order a customer would want to read them. */
  options: BillOption[];
}
