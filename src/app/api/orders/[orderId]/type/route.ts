import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { changeOrderType } from "@/server/order-changes";

const schema = z.object({
  type: z.enum(["DINE_IN", "TAKEAWAY"]),
  /** Required when switching to dine-in: the table they sat down at. */
  tableId: z.string().min(1).optional(),
});

// POST /api/orders/[orderId]/type — switch an unpaid order between dine-in and takeaway.
export const POST = defineHandler(
  {
    permission: "pos.order.changeType",
    input: schema,
    audit: (input, result) => ({
      action: "order.type.change",
      entityType: "Order",
      entityId: (result as { order?: { id: string } }).order?.id,
      metadata: { to: input.type },
    }),
  },
  async ({ session, params, input }) => {
    const order = await changeOrderType(session.tenantId, session.branchId, session.id, {
      orderId: params.orderId,
      type: input.type,
      tableId: input.tableId,
    });
    return { order };
  }
);
