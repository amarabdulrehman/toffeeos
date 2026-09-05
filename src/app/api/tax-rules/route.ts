import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { taxRulesOverlap, type PaymentMethodKey } from "@/lib/pricing";

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"] as const;

// GET /api/tax-rules — every tax rule for the signed-in admin's own branch, active or not (the UI
// needs inactive ones too, to let an owner re-enable one instead of only ever adding new). Scoped
// to session.branchId, same convention as /api/branch-settings.
export const GET = defineHandler({ permission: "settings.tax.manage" }, async ({ session, db }) => {
  const rules = await db.taxRule.findMany({
    where: { branchId: session.branchId },
    orderBy: { effectiveFrom: "asc" },
  });
  return { rules };
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  // Basis points, 0-10000 (0-100%) — same range/units as service charge.
  rateBasisPoints: z.number().int().min(0).max(10000),
  // Empty array = applies to every payment method (a plain flat rate, the common case). Naming
  // specific methods is only needed for a split-rate setup like Punjab PRA's cash/card difference.
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).default([]),
});

export const POST = defineHandler(
  {
    permission: "settings.tax.manage",
    input: createSchema,
    audit: (input) => ({ action: "tax_rule.create", entityType: "TaxRule", metadata: { ...input } }),
  },
  async ({ session, db, input }) => {
    const activeRules = await db.taxRule.findMany({
      where: { branchId: session.branchId, isActive: true },
      select: { name: true, paymentMethods: true },
    });
    const conflict = activeRules.find((r) =>
      taxRulesOverlap(r.paymentMethods as PaymentMethodKey[], input.paymentMethods as PaymentMethodKey[])
    );
    if (conflict) {
      throw new HttpError(
        400,
        `"${conflict.name}" is already active and covers one of the same payment methods. Deactivate it first, or narrow which methods this rule applies to.`
      );
    }

    const rule = await db.taxRule.create({
      data: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        name: input.name,
        rateBasisPoints: input.rateBasisPoints,
        paymentMethods: input.paymentMethods,
      },
    });
    return { rule };
  }
);
