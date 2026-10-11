import type { PaymentMethod } from "@/generated/prisma/client";

/** Punjab PRA split-rate default (16% cash / 8% card & digital) — the day-one tax rates for a new
 * restaurant's first branch, and for any later branch when there is no earlier branch to copy
 * from. Editable per branch afterwards in Settings. */
export function defaultTaxRuleRows(tenantId: string, branchId: string) {
  return [
    { tenantId, branchId, name: "Cash (PRA)", paymentMethods: ["CASH"] as PaymentMethod[], rateBasisPoints: 1600 },
    {
      tenantId,
      branchId,
      name: "Card & digital (PRA)",
      paymentMethods: ["CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"] as PaymentMethod[],
      rateBasisPoints: 800,
    },
  ];
}
