import { defineHandler } from "@/server/handler";
import { markOrderServed } from "@/server/orders";

export const POST = defineHandler({ permission: "orders.view" }, async ({ session, params }) => {
  const order = await markOrderServed(session.tenantId, session.branchId, params.orderId, session.id);
  return { order };
});
