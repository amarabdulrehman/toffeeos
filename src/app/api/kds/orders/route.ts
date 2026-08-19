import { defineHandler } from "@/server/handler";

// GET /api/kds/orders — active kitchen orders (sent-to-kitchen or ready, not yet served/paid),
// oldest first so the KDS naturally reads left-to-right in punch order.
export const GET = defineHandler({ permission: "kds.access" }, async ({ session, db }) => {
  const orders = await db.order.findMany({
    where: { branchId: session.branchId, status: { in: ["SENT_TO_KITCHEN", "READY"] } },
    orderBy: { sentToKitchenAt: "asc" },
    include: {
      lines: { include: { modifiers: true } },
      table: true,
    },
  });
  return { orders };
});
