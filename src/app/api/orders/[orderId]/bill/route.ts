import { defineHandler } from "@/server/handler";
import { getOrderBill } from "@/server/bill";

// GET /api/orders/[orderId]/bill — an unpaid order priced for every payment method, for printing
// a bill before payment. pos.receipt.print, the permission that governs putting an order on paper
// for a customer; it was declared from the start and gated nothing until now.
export const GET = defineHandler({ permission: "pos.receipt.print" }, async ({ session, params }) => {
  return getOrderBill(session.tenantId, session.branchId, params.orderId);
});
