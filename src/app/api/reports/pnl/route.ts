import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveReportBranchIds, resolveReportRange, pnlReport } from "@/server/reports";
import { isBusinessDay } from "@/lib/business-day";

const querySchema = z.object({
  from: z.string().refine(isBusinessDay, "Invalid date"),
  to: z.string().refine(isBusinessDay, "Invalid date"),
  branchId: z.string().min(1).optional(),
});

// GET /api/reports/pnl?from=...&to=...[&branchId=...] — cash-basis profit & loss.
//
// Gated on `finance.pnl.view` rather than a `reports.*` key, which also means defineHandler's
// module check resolves it to the `finance` module (see moduleForPermission) — so this route rides
// the Expenses feature toggle, not the Full Report Suite one. That's deliberate: the cost half of
// this report is expense data, and a tenant without Expenses enabled would get a P&L that is all
// revenue and no costs, i.e. actively misleading rather than merely incomplete.
export const GET = defineHandler({ permission: "finance.pnl.view", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const range = await resolveReportRange(session.tenantId, branchIds, input.from, input.to);
  return pnlReport(session.tenantId, branchIds, range);
});
