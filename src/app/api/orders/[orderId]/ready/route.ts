import { defineHandler } from "@/server/handler";
import { markOrderReady } from "@/server/orders";

export const POST = defineHandler({ permission: "kds.order.markReady" }, async ({ session, params }) => {
  const order = await markOrderReady(session.tenantId, session.branchId, params.orderId, session.id);
  return { order };
});
