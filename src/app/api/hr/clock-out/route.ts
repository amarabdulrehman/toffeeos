import { defineHandler } from "@/server/handler";
import { clockOut } from "@/server/hr";

// POST /api/hr/clock-out — any signed-in staff member clocking themselves out. No permission gate
// beyond being authenticated: this only ever touches the caller's own attendance record.
export const POST = defineHandler({}, async ({ session }) => {
  const record = await clockOut(session.tenantId, session.id);
  return { record };
});
