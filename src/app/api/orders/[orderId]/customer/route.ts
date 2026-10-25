import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { attachCustomerAfterPayment } from "@/server/paid-order-edits";

const schema = z.object({ customerId: z.string().min(1) });

// POST /api/orders/[orderId]/customer — put a customer on a bill paid without one, with its points.
// Front-of-house work, so it rides on taking payment rather than on managing the customer list.
export const POST = defineHandler(
  {
    permission: "pos.payment.take",
    input: schema,
    audit: (input) => ({ action: "order.customer.add", entityType: "Order", metadata: { customerId: input.customerId } }),
  },
  async ({ session, params, input }) =>
    attachCustomerAfterPayment(session.tenantId, session.branchId, session.id, { orderId: params.orderId, customerId: input.customerId })
);
