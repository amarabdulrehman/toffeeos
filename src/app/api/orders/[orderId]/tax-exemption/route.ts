import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { setTaxExemption } from "@/server/order-changes";

const schema = z.object({
  // Required and specific: an exemption is a tax matter, and "why no tax on this?" gets asked by
  // an owner, an accountant, or the tax office — never by nobody.
  reason: z.string().trim().min(3, "Say why this order is tax exempt.").max(200),
});

// PUT /api/orders/[orderId]/tax-exemption — sell this order without tax, with the reason.
export const PUT = defineHandler(
  {
    permission: "pos.tax.exempt",
    input: schema,
    audit: (input, result) => ({
      action: "order.tax.exempt",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
      metadata: { reason: input.reason },
    }),
  },
  async ({ session, params, input }) => {
    const order = await setTaxExemption(session.tenantId, session.branchId, session.id, {
      orderId: params.orderId,
      reason: input.reason,
    });
    return { order };
  }
);

// DELETE /api/orders/[orderId]/tax-exemption — charge tax on it again.
export const DELETE = defineHandler(
  {
    permission: "pos.tax.exempt",
    audit: (_input, result) => ({
      action: "order.tax.exemptRemoved",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
    }),
  },
  async ({ session, params }) => {
    const order = await setTaxExemption(session.tenantId, session.branchId, session.id, {
      orderId: params.orderId,
      reason: null,
    });
    return { order };
  }
);
