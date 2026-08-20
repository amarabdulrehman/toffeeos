import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createShift, listShifts } from "@/server/hr";
import { resolveReportBranchIds } from "@/server/reports";

const querySchema = z.object({ from: z.string().datetime(), to: z.string().datetime(), branchId: z.string().min(1).optional() });

export const GET = defineHandler({ permission: "hr.shift.assign", input: querySchema }, async ({ session, input }) => {
  const branchIds = await resolveReportBranchIds(session, input.branchId);
  const shifts = await listShifts(session.tenantId, branchIds, { from: new Date(input.from), to: new Date(input.to) });
  return { shifts };
});

const bodySchema = z.object({
  userId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  branchId: z.string().min(1).optional(),
});

export const POST = defineHandler({ permission: "hr.shift.assign", input: bodySchema }, async ({ session, input }) => {
  const shift = await createShift(
    session.tenantId,
    input.branchId ?? session.branchId,
    input.userId,
    new Date(input.startsAt),
    new Date(input.endsAt),
    session.id
  );
  return { shift };
});
