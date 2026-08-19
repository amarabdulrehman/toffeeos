import { defineHandler } from "@/server/handler";
import { sendToKitchen } from "@/server/orders";

export const POST = defineHandler({ permission: "pos.kot.print" }, async ({ session, params }) => {
  const order = await sendToKitchen(session.tenantId, session.branchId, params.orderId, session.id);
  return { order };
});
