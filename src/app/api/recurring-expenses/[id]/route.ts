import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { deactivateRecurring, updateRecurring } from "@/server/expenses";
import { resolveReportBranchIds } from "@/server/reports";

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"] as const;

// `startsOn` is absent on purpose — see updateRecurring's doc comment. dayOfMonth keeps the same
// 1-28 cap as creation; the generator depends on every month having the chosen day.
const patchSchema = z.object({
  categoryId: z.string().min(1).optional(),
  amountPaisa: z.number().int().positive().max(1_000_000_00).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  endsOn: z.string().datetime().nullable().optional(),
  vendorName: z.string().max(120).nullable().optional(),
  method: z.enum(PAYMENT_METHODS).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = defineHandler(
  {
    permission: "finance.expense.create",
    input: patchSchema,
    audit: (_input, result) => {
      const r = result as { recurring: { id: string }; changes: Record<string, unknown> };
      if (Object.keys(r.changes).length === 0) return null;
      return {
        action: "finance.recurringExpense.update",
        entityType: "RecurringExpense",
        entityId: r.recurring.id,
        metadata: r.changes,
      };
    },
  },
  async ({ session, params, input }) => {
    const branchIds = await resolveReportBranchIds(session);
    return updateRecurring(session.tenantId, branchIds, params.id, {
      ...input,
      endsOn: input.endsOn === undefined ? undefined : input.endsOn === null ? null : new Date(input.endsOn),
    });
  }
);

// Deactivates rather than deletes: expenses already generated from this template keep their
// recurringExpenseId, and the template row is what gives that id meaning. Deactivating also stops
// the daily cron from generating any further occurrences.
export const DELETE = defineHandler(
  {
    permission: "finance.expense.create",
    audit: (_input, result) => ({
      action: "finance.recurringExpense.deactivate",
      entityType: "RecurringExpense",
      entityId: (result as { id: string }).id,
    }),
  },
  async ({ session, params }) => {
    const branchIds = await resolveReportBranchIds(session);
    return deactivateRecurring(session.tenantId, branchIds, params.id);
  }
);
