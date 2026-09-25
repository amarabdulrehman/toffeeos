import { defineHandler } from "@/server/handler";
import { recentlyBumped } from "@/server/order-changes";

// GET /api/kds/recent — orders bumped off the kitchen screen in the last few hours, for recall.
export const GET = defineHandler({ permission: "kds.access" }, async ({ session }) => {
  return { orders: await recentlyBumped(session.tenantId, session.branchId) };
});
