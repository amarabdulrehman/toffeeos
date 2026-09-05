import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listRecurring, createRecurring } from "@/server/expenses";
import { resolveReportBranchIds } from "@/server/reports";

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"] as const;

export const GET = defineHandler(
  { permission: "finance.expense.create" },
  async ({ session }) => {
    const branchIds = await resolveReportBranchIds(session);
    const recurring = await listRecurring(session.tenantId, branchIds);
    return { recurring };
  }
);

const createSchema = z.object({
  categoryId: z.string().min(1),
  amountPaisa: z.number().int().positive().max(1_000_000_00),
  // Capped at 28 deliberately: this sidesteps "the 31st in February" entirely rather than adding
  // month-length clamping logic that nobody will remember exists. The generator in
  // src/lib/recurrence.ts depends on this invariant — Date.UTC(y, m, 29+) would silently roll into
  // the following month.
  dayOfMonth: z.number().int().min(1).max(28),
  startsOn: z.string().datetime(),
  endsOn: z.string().datetime().nullable().optional(),
  vendorName: z.string().max(120).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  note: z.string().max(500).optional(),
});

export const POST = defineHandler(
  {
    permission: "finance.expense.create",
    input: createSchema,
    audit: (input, result) => ({
      action: "finance.recurringExpense.create",
      entityType: "RecurringExpense",
      entityId: (result as { id: string }).id,
      metadata: { ...input },
    }),
  },
  async ({ session, input }) =>
    createRecurring(session.tenantId, session.branchId, session.id, {
      ...input,
      startsOn: new Date(input.startsOn),
      endsOn: input.endsOn ? new Date(input.endsOn) : null,
    })
);
