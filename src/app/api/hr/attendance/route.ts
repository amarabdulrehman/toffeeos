import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listAttendance } from "@/server/hr";
import { resolveReportBranchIds } from "@/server/reports";

const querySchema = z.object({ from: z.string().datetime(), to: z.string().datetime(), branchId: z.string().min(1).optional() });

export const GET = defineHandler({ permission: "hr.attendance.edit", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const records = await listAttendance(session.tenantId, branchIds, { from: new Date(input.from), to: new Date(input.to) });
  return { records };
});
