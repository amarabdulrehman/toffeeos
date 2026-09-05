import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { deleteExpense, updateExpense } from "@/server/expenses";
import { resolveReportBranchIds } from "@/server/reports";

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"] as const;

// Every field optional — this is a partial edit, and Prisma leaves `undefined` fields untouched.
// The nullable ones accept an explicit null to clear them, which is why they're `.nullable()`
// rather than merely optional.
const patchSchema = z.object({
  categoryId: z.string().min(1).optional(),
  amountPaisa: z.number().int().positive().max(1_000_000_00).optional(),
  spentAt: z.string().datetime().optional(),
  vendorName: z.string().max(120).nullable().optional(),
  method: z.enum(PAYMENT_METHODS).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const PATCH = defineHandler(
  {
    permission: "finance.expense.create",
    input: patchSchema,
    audit: (_input, result) => {
      const r = result as { expense: { id: string }; changes: Record<string, unknown> };
      // Skip the log entirely when nothing actually differed — a no-op save shouldn't leave a
      // trail implying the figures were touched.
      if (Object.keys(r.changes).length === 0) return null;
      return {
        action: "finance.expense.update",
        entityType: "Expense",
        entityId: r.expense.id,
        metadata: r.changes,
      };
    },
  },
  async ({ session, params, input }) => {
    const branchIds = await resolveReportBranchIds(session);
    return updateExpense(session.tenantId, branchIds, params.expenseId, {
      ...input,
      spentAt: input.spentAt ? new Date(input.spentAt) : undefined,
    });
  }
);

// Expenses hard-delete rather than archive, unlike inventory items and expense categories: nothing
// else references an Expense row (no historical document points at it the way an old expense points
// at its category), so a mistyped entry should genuinely disappear rather than linger as a
// zero-value ghost in the log. The audit entry below is what preserves the record of the deletion.
export const DELETE = defineHandler(
  {
    permission: "finance.expense.create",
    audit: (_input, result) => {
      const e = result as { id: string; amountPaisa: number; categoryId: string; spentAt: Date };
      return {
        action: "finance.expense.delete",
        entityType: "Expense",
        entityId: e.id,
        // Once the row is deleted this metadata is the only surviving record of what it was.
        metadata: { amountPaisa: e.amountPaisa, categoryId: e.categoryId, spentAt: e.spentAt.toISOString() },
      };
    },
  },
  async ({ session, params }) => {
    // Scoped to the branches this session may see, so a branch manager can't delete another
    // branch's expense by guessing its id.
    const branchIds = await resolveReportBranchIds(session);
    return deleteExpense(session.tenantId, branchIds, params.expenseId);
  }
);
