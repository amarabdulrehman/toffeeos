import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { redeemOnOrder } from "@/server/loyalty";

const schema = z.object({ points: z.number().int().positive() });

// POST /api/orders/[orderId]/redeem-points — spend the customer's points as money off this bill.
// Whoever takes payment may do it: the points are the customer's, not the cashier's discretion.
export const POST = defineHandler(
  {
    permission: "pos.payment.take",
    input: schema,
    audit: (input, result) => ({
      action: "loyalty.redeem",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
      metadata: { points: input.points },
    }),
  },
  async ({ session, params, input }) => {
    return { order: await redeemOnOrder(session.tenantId, session.branchId, session.id, { orderId: params.orderId, points: input.points }) };
  }
);
