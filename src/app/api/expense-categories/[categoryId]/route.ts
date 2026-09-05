import { defineHandler } from "@/server/handler";
import { archiveCategory } from "@/server/expenses";

// Archives (soft-deletes). Historical expenses keep pointing at this row so their category name
// still renders in the log — see archiveCategory in src/server/expenses.ts.
export const DELETE = defineHandler(
  {
    permission: "finance.expense.create",
    audit: (_input, result) => ({
      action: "finance.expenseCategory.archive",
      entityType: "ExpenseCategory",
      entityId: (result as { id: string }).id,
    }),
  },
  async ({ session, params }) => archiveCategory(session.tenantId, params.categoryId)
);
