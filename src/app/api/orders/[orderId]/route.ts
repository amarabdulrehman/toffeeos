import { defineHandler, HttpError } from "@/server/handler";

// GET /api/orders/[orderId] — one order as the Order Queue shows it, for a screen that has just
// changed it and needs to show the result. Same permission and shape as the queue itself.
export const GET = defineHandler({ permission: "orders.view" }, async ({ session, db, params }) => {
  const order = await db.order.findFirst({
    where: { id: params.orderId, branchId: session.branchId },
    include: { lines: { include: { modifiers: true } }, table: true, payments: true },
  });
  if (!order) throw new HttpError(404, "That order doesn't exist.");
  return { order };
});
