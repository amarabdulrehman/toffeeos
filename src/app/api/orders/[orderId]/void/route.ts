import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { voidOrder } from "@/server/orders";

const voidSchema = z.object({
  reason: z.string().max(280).optional(),
  actionId: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const POST = defineHandler(
  { permission: "pos.order.void", input: voidSchema },
  async ({ session, params, input }) => {
    const order = await voidOrder(
      session.tenantId,
      session.branchId,
      params.orderId,
      session.id,
      input.reason,
      input.actionId,
      input.expectedVersion
    );
    return { order };
  }
);
