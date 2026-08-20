import { defineHandler } from "@/server/handler";
import { deleteShift } from "@/server/hr";

export const DELETE = defineHandler({ permission: "hr.shift.assign" }, async ({ session, params }) => {
  await deleteShift(session.tenantId, params.shiftId);
  return { ok: true };
});
