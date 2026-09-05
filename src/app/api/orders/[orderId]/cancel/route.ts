import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { cancelSentOrder } from "@/server/orders";

const cancelSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required.").max(280),
});

// POST /api/orders/[orderId]/cancel — the cashier-facing "cancel an order already sent to the
// kitchen" action, distinct from /void (which stays manager-only and doesn't require a reason).
// Always creates a reviewable OrderCancellation row — see cancelSentOrder in src/server/orders.ts.
export const POST = defineHandler(
  { permission: "orders.cancel", input: cancelSchema },
  async ({ session, params, input }) => {
    const order = await cancelSentOrder(session.tenantId, session.branchId, params.orderId, session.id, input.reason);
    return { order };
  }
);
