import { defineHandler } from "@/server/handler";
import { markPickedUp } from "@/server/delivery";

export const POST = defineHandler({ permission: "delivery.riderApp.access" }, async ({ session, params }) => {
  const order = await markPickedUp(session.tenantId, session.branchId, params.orderId, session.id);
  return { order };
});
