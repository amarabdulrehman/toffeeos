import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { sendToKitchen } from "@/server/orders";

const bodySchema = z.object({ actionId: z.string().min(1).optional() });

export const POST = defineHandler({ permission: "pos.kot.print", input: bodySchema }, async ({ session, params, input }) => {
  const order = await sendToKitchen(session.tenantId, session.branchId, params.orderId, session.id, input.actionId);
  return { order };
});
