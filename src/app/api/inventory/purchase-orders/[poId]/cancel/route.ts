import { defineHandler } from "@/server/handler";
import { cancelPurchaseOrder } from "@/server/purchasing";

// POST /api/inventory/purchase-orders/[poId]/cancel — a draft or approved order that won't come.
// Approve permission: once approved it is a commitment, and taking it back is the approver's call.
export const POST = defineHandler(
  {
    permission: "inventory.purchaseOrder.approve",
    audit: (_input, result) => ({
      action: "purchaseOrder.cancel",
      entityType: "PurchaseOrder",
      entityId: (result as { purchaseOrder?: { id: string } }).purchaseOrder?.id,
    }),
  },
  async ({ session, params }) => {
    return { purchaseOrder: await cancelPurchaseOrder(session.tenantId, session.branchId, session.id, params.poId) };
  }
);
