import { defineHandler, HttpError } from "@/server/handler";
import { listOrderDeletions } from "@/server/order-deletion";

// GET /api/orders/deletions — the deletion log, owner only. Deliberately not behind the "Delete
// orders" switch: if a platform admin turns the feature off, the record of what was already
// deleted has to stay readable.
export const GET = defineHandler({ permission: "orders.view" }, async ({ session, db }) => {
  const owner = await db.membership.findFirst({
    where: { userId: session.id, isActive: true, role: { key: "owner" } },
    select: { id: true },
  });
  if (!owner) throw new HttpError(403, "Only the restaurant owner can see deleted orders.");
  return { deletions: await listOrderDeletions(session.tenantId) };
});
