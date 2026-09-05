import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { taxRulesOverlap, type PaymentMethodKey } from "@/lib/pricing";

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"] as const;

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  rateBasisPoints: z.number().int().min(0).max(10000).optional(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/tax-rules/[id] — edit a rule's rate/scope, or toggle it on/off. Toggling off (not
// deleting) is how "turn tax off" without losing the configuration works — resolveTaxRate() in
// src/lib/pricing.ts already skips inactive rules and falls back to 0% tax when none match, so
// deactivating every rule on a branch is a real, safe "no tax" state, not a special case.
export const PATCH = defineHandler(
  {
    permission: "settings.tax.manage",
    input: patchSchema,
    audit: (input) => ({ action: "tax_rule.update", entityType: "TaxRule", metadata: { ...input } }),
  },
  async ({ session, db, params, input }) => {
    const existing = await db.taxRule.findFirst({ where: { id: params.id, branchId: session.branchId } });
    if (!existing) throw new HttpError(404, "Not found");

    const effective = {
      isActive: input.isActive ?? existing.isActive,
      paymentMethods: (input.paymentMethods ?? existing.paymentMethods) as PaymentMethodKey[],
    };
    if (effective.isActive) {
      const otherActiveRules = await db.taxRule.findMany({
        where: { branchId: session.branchId, isActive: true, id: { not: params.id } },
        select: { name: true, paymentMethods: true },
      });
      const conflict = otherActiveRules.find((r) =>
        taxRulesOverlap(r.paymentMethods as PaymentMethodKey[], effective.paymentMethods)
      );
      if (conflict) {
        throw new HttpError(
          400,
          `"${conflict.name}" is already active and covers one of the same payment methods. Deactivate it first, or narrow which methods this rule applies to.`
        );
      }
    }

    const rule = await db.taxRule.update({ where: { id: params.id }, data: input });
    return { rule };
  }
);

// DELETE /api/tax-rules/[id] — a real delete, unlike branches/staff: nothing references a TaxRule
// by id (an order's taxPaisa is a computed, already-persisted historical amount, not a live
// pointer back to the rule that produced it), so removing an unwanted rule orphans nothing.
export const DELETE = defineHandler(
  {
    permission: "settings.tax.manage",
    audit: () => ({ action: "tax_rule.delete", entityType: "TaxRule" }),
  },
  async ({ session, db, params }) => {
    const existing = await db.taxRule.findFirst({ where: { id: params.id, branchId: session.branchId } });
    if (!existing) throw new HttpError(404, "Not found");

    await db.taxRule.delete({ where: { id: params.id } });
    return { ok: true };
  }
);
