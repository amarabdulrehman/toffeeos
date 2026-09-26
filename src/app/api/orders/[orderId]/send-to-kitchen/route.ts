import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { sendToKitchen } from "@/server/orders";
import { ordersNeedApproval, requestNewOrderApproval } from "@/server/order-approvals";

const bodySchema = z.object({ actionId: z.string().min(1).optional() });

export const POST = defineHandler({ permission: "pos.kot.print", input: bodySchema }, async ({ session, params, input }) => {
  // A branch that holds waiter orders for the counter: the order waits there instead — see
  // src/server/order-approvals.ts. The offline queue's replay comes through here too, so an order a
  // waiter punched offline waits the same way once it syncs.
  if (await ordersNeedApproval(session.tenantId, session.branchId, session.permissions)) {
    const held = await requestNewOrderApproval(session.tenantId, session.branchId, params.orderId, session.id);
    return held;
  }
  const order = await sendToKitchen(session.tenantId, session.branchId, params.orderId, session.id, input.actionId);
  return { order, awaitingApproval: false };
});
