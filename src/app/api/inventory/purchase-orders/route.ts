import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createPurchaseOrder, listPurchaseOrders } from "@/server/purchasing";

// GET /api/inventory/purchase-orders — this branch's purchase orders, newest first.
export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  return { purchaseOrders: await listPurchaseOrders(session.tenantId, session.branchId) };
});

const schema = z.object({
  supplierId: z.string().min(1),
  locationId: z.string().min(1),
  notes: z.string().max(500).nullish(),
  lines: z
    .array(z.object({ itemId: z.string().min(1), quantity: z.number().positive(), unitCostPaisa: z.number().int().nonnegative() }))
    .min(1)
    .max(100),
});

// POST /api/inventory/purchase-orders — draft an order to a supplier. Nothing is spent or received.
export const POST = defineHandler(
  {
    permission: "inventory.purchaseOrder.create",
    input: schema,
    audit: (input, result) => ({
      action: "purchaseOrder.create",
      entityType: "PurchaseOrder",
      entityId: (result as { purchaseOrder?: { id: string } }).purchaseOrder?.id,
      metadata: { supplierId: input.supplierId, lines: input.lines.length },
    }),
  },
  async ({ session, input }) => {
    return { purchaseOrder: await createPurchaseOrder(session.tenantId, session.branchId, session.id, input) };
  }
);
