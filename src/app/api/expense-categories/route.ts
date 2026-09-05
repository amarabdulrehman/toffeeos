import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listCategories, createCategory } from "@/server/expenses";

// Categories are tenant-wide, not per-branch, so there's no branch scoping here — a branch manager
// sees the same list the owner does.

export const GET = defineHandler(
  { permission: "finance.expense.create" },
  async ({ session }) => {
    const categories = await listCategories(session.tenantId);
    return { categories };
  }
);

const createSchema = z.object({ name: z.string().min(1).max(60) });

export const POST = defineHandler(
  {
    permission: "finance.expense.create",
    input: createSchema,
    audit: (input, result) => ({
      action: "finance.expenseCategory.create",
      entityType: "ExpenseCategory",
      entityId: (result as { id: string }).id,
      metadata: { name: input.name },
    }),
  },
  async ({ session, input }) => createCategory(session.tenantId, input.name)
);
