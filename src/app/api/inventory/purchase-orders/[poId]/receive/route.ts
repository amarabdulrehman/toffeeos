import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { receivePurchaseOrder } from "@/server/purchasing";

const schema = z.object({
  /** What arrived, per line. A line left out arrived in full. */
  received: z.array(z.object({ lineId: z.string().min(1), quantity: z.number().nonnegative() })).max(100).optional(),
});

// POST /api/inventory/purchase-orders/[poId]/receive — the delivery arrived; count it into stock.
// The same permission as receiving stock by hand, because that is what this is.
export const POST = defineHandler(
  {
    permission: "inventory.grn.create",
    input: schema,
    audit: (input, result) => ({
      action: "purchaseOrder.receive",
      entityType: "PurchaseOrder",
      entityId: (result as { purchaseOrder?: { id: string } }).purchaseOrder?.id,
      metadata: { received: input.received ?? "in full" },
    }),
  },
  async ({ session, params, input }) => {
    return { purchaseOrder: await receivePurchaseOrder(session.tenantId, session.branchId, session.id, params.poId, input.received) };
  }
);
