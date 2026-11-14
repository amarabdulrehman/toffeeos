import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { setOrderDiscount } from "@/server/order-changes";

const putSchema = z.object({
  type: z.enum(["PERCENT", "FIXED"]),
  /** PERCENT in basis points (1000 = 10%), FIXED in paisa — as at the till. */
  value: z.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
});

// PUT /api/orders/[orderId]/discount — give, or change, a whole-bill discount on an unpaid order
// after it was punched. Same permission and ceiling as at the till; see setOrderDiscount.
export const PUT = defineHandler(
  {
    permission: "pos.discount.applyOrder",
    input: putSchema,
    audit: (input) => ({ action: "order.discount.set", entityType: "Order", metadata: { ...input } }),
  },
  async ({ session, params, input }) => {
    const order = await setOrderDiscount(
      session.tenantId,
      session.branchId,
      session.id,
      { orderId: params.orderId, discount: { type: input.type, value: input.value }, reason: input.reason },
      session.permissions.includes("pos.discount.exceedMax")
    );
    return { order };
  }
);

// DELETE — take the discount off again.
export const DELETE = defineHandler(
  {
    permission: "pos.discount.applyOrder",
    audit: () => ({ action: "order.discount.remove", entityType: "Order" }),
  },
  async ({ session, params }) => {
    const order = await setOrderDiscount(session.tenantId, session.branchId, session.id, { orderId: params.orderId, discount: null }, false);
    return { order };
  }
);
