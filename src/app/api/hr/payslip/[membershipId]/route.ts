import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getPayslip } from "@/server/hr";

const querySchema = z.object({ from: z.string().datetime(), to: z.string().datetime() });

export const GET = defineHandler({ permission: "hr.payroll.view", input: querySchema }, async ({ session, params, input }) => {
  return getPayslip(session.tenantId, params.membershipId, { from: new Date(input.from), to: new Date(input.to) });
});
