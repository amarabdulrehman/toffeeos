import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { getDrawerDay, listDrawerDays, openDrawerDay, closeDrawerDay } from "@/server/cash-drawer";
import { assertWritableBranchId } from "@/server/reports";

/**
 * The drawer is always one branch's drawer, so unlike the report routes there is no "all branches"
 * mode: a combined float across three branches is not a thing anyone can count. The branch defaults
 * to the caller's own, and assertWritableBranchId stops a branch manager reaching another branch's
 * till.
 *
 * Uses the pos.shift.open / pos.shift.close permissions, which the original design declared and
 * never built — same situation the finance.* ones were in before expense tracking landed. Cashiers
 * already hold both, which is right: counting the drawer is their job, not the owner's.
 */

const MAX_PAISA = 10_000_000_00; // Rs 10,000,000 — a typo guard, not a business limit.

const listSchema = z.object({
  branchId: z.string().min(1).optional(),
  businessDate: z.string().optional(),
  history: z.coerce.boolean().optional(),
});

export const GET = defineHandler({ permission: "pos.shift.open", input: listSchema }, async ({ session, input }) => {
  const branchId = input.branchId ?? session.branchId;
  await assertWritableBranchId(session, branchId);
  if (input.history) {
    return { days: await listDrawerDays(session.tenantId, branchId) };
  }
  return { day: await getDrawerDay(session.tenantId, branchId, input.businessDate) };
});

const openSchema = z.object({
  branchId: z.string().min(1).optional(),
  businessDate: z.string().optional(),
  openingBalancePaisa: z.number().int().min(0).max(MAX_PAISA),
  note: z.string().max(500).nullish(),
});

export const POST = defineHandler(
  {
    permission: "pos.shift.open",
    input: openSchema,
    audit: (input) => ({ action: "cash.drawer.open", entityType: "CashDrawerDay", metadata: { ...input } }),
  },
  async ({ session, input }) => {
    const branchId = input.branchId ?? session.branchId;
    await assertWritableBranchId(session, branchId);
    const day = await openDrawerDay(session.tenantId, branchId, session.id, input);
    return { day };
  }
);

const closeSchema = z.object({
  branchId: z.string().min(1).optional(),
  businessDate: z.string().optional(),
  closingCountedPaisa: z.number().int().min(0).max(MAX_PAISA),
  note: z.string().max(500).nullish(),
});

export const PATCH = defineHandler(
  {
    permission: "pos.shift.close",
    input: closeSchema,
    // The variance is what an owner comes back to this log for, so it is recorded alongside the
    // counted figure rather than left to be recomputed from a day whose numbers may have moved. A
    // correction (see closeDrawerDay) gets its own action name and the figure it overwrote, so the
    // log reads as "X corrected this from Y" rather than an unexplained second close entry.
    audit: (input, result) => {
      const r = result as { day: { variancePaisa: number | null }; isCorrection: boolean; previousClosingCountedPaisa: number | null };
      return {
        action: r.isCorrection ? "cash.drawer.correctClose" : "cash.drawer.close",
        entityType: "CashDrawerDay",
        metadata: {
          ...input,
          variancePaisa: r.day.variancePaisa,
          ...(r.isCorrection ? { previousClosingCountedPaisa: r.previousClosingCountedPaisa } : {}),
        },
      };
    },
  },
  async ({ session, input }) => {
    const branchId = input.branchId ?? session.branchId;
    await assertWritableBranchId(session, branchId);
    const result = await closeDrawerDay(session.tenantId, branchId, session.id, session.permissions, input);
    // A variance is the one thing here worth making impossible to miss, so it is named in the
    // response rather than left for the client to derive from two numbers.
    if (result.day.variancePaisa == null) throw new HttpError(500, "The drawer closed without a variance.");
    return result;
  }
);
