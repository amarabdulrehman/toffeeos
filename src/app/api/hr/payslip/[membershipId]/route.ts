import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getPayslip } from "@/server/hr";
import { assertWritableMembership } from "@/server/reports";

const querySchema = z.object({ from: z.string().datetime(), to: z.string().datetime() });

// The membershipId comes straight from the URL, so it has to be checked against the caller's own
// branch before it reaches getPayslip — which scopes by tenant (RLS) but not by branch. Without
// this, a Branch Manager could read any employee's pay rate, hours and gross pay at any other
// branch in the tenant just by changing the id. The write-side HR routes (pay-profiles PATCH,
// payroll/disburse) already went through this same helper; this read never did.
export const GET = defineHandler({ permission: "hr.payroll.view", input: querySchema }, async ({ session, params, input }) => {
  const { membershipId } = await assertWritableMembership(session, params.membershipId);
  return getPayslip(session.tenantId, membershipId, { from: new Date(input.from), to: new Date(input.to) });
});
