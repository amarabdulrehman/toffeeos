import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { correctPaymentMethod } from "@/server/paid-order-edits";

const schema = z.object({
  method: z.enum(["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"]),
  reason: z.string().trim().min(2, "Say why the payment method is being changed.").max(200),
});

// POST /api/orders/[orderId]/payment-method — correct how a paid bill was paid. See correctPaymentMethod.
export const POST = defineHandler(
  {
    permission: "pos.payment.correct",
    input: schema,
    audit: (input, result) => {
      const r = result as { order: { id: string }; from: string; oldTotalPaisa: number; differencePaisa: number };
      return {
        action: "order.payment.correct",
        entityType: "Order",
        entityId: r.order.id,
        metadata: { from: r.from, to: input.method, oldTotalPaisa: r.oldTotalPaisa, differencePaisa: r.differencePaisa, reason: input.reason },
      };
    },
  },
  async ({ session, params, input }) =>
    correctPaymentMethod(
      session.tenantId,
      session.branchId,
      session.id,
      { orderId: params.orderId, method: input.method, reason: input.reason },
      session.permissions.includes("pos.cashDrawer.correctClose")
    )
);
