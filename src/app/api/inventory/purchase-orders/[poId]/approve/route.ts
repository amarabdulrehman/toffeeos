import { defineHandler } from "@/server/handler";
import { approvePurchaseOrder } from "@/server/purchasing";

// POST /api/inventory/purchase-orders/[poId]/approve — agree to spend it.
export const POST = defineHandler(
  {
    permission: "inventory.purchaseOrder.approve",
    audit: (_input, result) => ({
      action: "purchaseOrder.approve",
      entityType: "PurchaseOrder",
      entityId: (result as { purchaseOrder?: { id: string } }).purchaseOrder?.id,
    }),
  },
  async ({ session, params }) => {
    return { purchaseOrder: await approvePurchaseOrder(session.tenantId, session.branchId, session.id, params.poId) };
  }
);
