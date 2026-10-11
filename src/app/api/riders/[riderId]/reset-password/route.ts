import { defineHandler } from "@/server/handler";
import { resetRiderPassword } from "@/server/riders";

// POST /api/riders/[riderId]/reset-password — a new password for a rider, shown once. Signs them
// out of every device.
export const POST = defineHandler(
  {
    permission: "delivery.manageRiders",
    audit: () => ({ action: "rider.resetPassword", entityType: "User" }),
  },
  async ({ session, params }) => resetRiderPassword(session.tenantId, session.branchId, params.riderId)
);
