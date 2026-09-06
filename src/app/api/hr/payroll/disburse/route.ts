import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordDisbursement } from "@/server/hr";
import { assertWritableMembership } from "@/server/reports";

const schema = z.object({
  membershipId: z.string().min(1),
  branchId: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  regularHours: z.number().min(0),
  overtimeHours: z.number().min(0).default(0),
  grossPayPaisa: z.number().int().positive(),
  method: z.string().max(60).optional(),
  note: z.string().max(280).optional(),
});

// POST /api/hr/payroll/disburse — marks a specific person's pay for a specific period as actually
// handed over. Snapshots the numbers the caller is currently looking at (computed live by
// runPayroll) rather than recomputing server-side, since the whole point is recording what was
// actually paid at this moment — a later pay-rate edit shouldn't retroactively change that.
export const POST = defineHandler(
  {
    permission: "hr.payroll.run",
    input: schema,
    audit: (input) => ({
      action: "payroll.disburse",
      entityType: "PayrollDisbursement",
      metadata: { membershipId: input.membershipId, grossPayPaisa: input.grossPayPaisa },
    }),
  },
  async ({ session, input }) => {
    // The membership decides the branch, and the caller must be allowed to write there. The
    // branchId in the body is ignored rather than trusted — paying someone at a branch they do not
    // work at was never meaningful, it was just unchecked.
    const target = await assertWritableMembership(session, input.membershipId);
    const disbursement = await recordDisbursement(session.tenantId, session.id, {
      membershipId: target.membershipId,
      branchId: target.branchId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      regularHours: input.regularHours,
      overtimeHours: input.overtimeHours,
      grossPayPaisa: input.grossPayPaisa,
      method: input.method,
      note: input.note,
    });
    return { disbursement };
  }
);
