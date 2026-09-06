import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { assignRider } from "@/server/delivery";

const schema = z.object({ riderId: z.string().min(1) });

export const POST = defineHandler(
  { permission: "delivery.assignRider", input: schema },
  async ({ session, params, input }) => {
    const order = await assignRider(
      session.tenantId,
      session.branchId,
      params.orderId,
      input.riderId,
      session.id,
      session.permissions
    );
    return { order };
  }
);
