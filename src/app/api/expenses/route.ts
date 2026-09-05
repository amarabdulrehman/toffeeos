import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listExpenses, createExpense } from "@/server/expenses";
import { resolveReportBranchIds } from "@/server/reports";

// GET and POST both sit behind `finance.expense.create` — there is no separate view permission in
// the registry, and inventing one now would mean every existing role's permission array is missing
// it. Anyone who can see this page can record on it; that's the same shape Inventory uses.

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"] as const;

const listSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  branchId: z.string().min(1).optional(),
});

export const GET = defineHandler(
  { permission: "finance.expense.create", input: listSchema },
  async ({ session, input }) => {
    const branchIds = await resolveReportBranchIds(session, input.branchId);
    const expenses = await listExpenses(session.tenantId, branchIds, {
      from: new Date(input.from),
      to: new Date(input.to),
    });
    return { expenses };
  }
);

const createSchema = z.object({
  categoryId: z.string().min(1),
  // Money crosses the API as integer paisa, never rupees — the UI does the *100 conversion. Same
  // rule as every other money field in the system (see src/lib/money.ts).
  amountPaisa: z.number().int().positive().max(1_000_000_00),
  spentAt: z.string().datetime(),
  vendorName: z.string().max(120).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  note: z.string().max(500).optional(),
});

export const POST = defineHandler(
  {
    permission: "finance.expense.create",
    input: createSchema,
    audit: (input) => ({
      action: "finance.expense.create",
      entityType: "Expense",
      metadata: { ...input },
    }),
  },
  async ({ session, input }) => {
    const canApprove = session.permissions.includes("finance.expense.approve");
    return createExpense(session.tenantId, session.branchId, session.id, canApprove, {
      ...input,
      spentAt: new Date(input.spentAt),
    });
  }
);
