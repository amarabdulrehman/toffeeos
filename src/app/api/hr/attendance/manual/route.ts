import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordManualAttendance } from "@/server/hr";

const bodySchema = z.object({
  branchId: z.string().min(1).optional(),
  userId: z.string().min(1),
  clockInAt: z.string().datetime(),
  clockOutAt: z.string().datetime().nullable().optional(),
  note: z.string().min(1).max(280),
});

export const POST = defineHandler({ permission: "hr.attendance.edit", input: bodySchema }, async ({ session, input }) => {
  const record = await recordManualAttendance(session.tenantId, session.id, {
    branchId: input.branchId ?? session.branchId,
    userId: input.userId,
    clockInAt: new Date(input.clockInAt),
    clockOutAt: input.clockOutAt ? new Date(input.clockOutAt) : null,
    note: input.note,
  });
  return { record };
});
