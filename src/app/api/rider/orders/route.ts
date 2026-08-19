import { defineHandler } from "@/server/handler";
import { listMyDeliveries } from "@/server/delivery";

// This is the hard boundary: listMyDeliveries always filters by assignedRiderId === session.user.id
// regardless of any other permission the session carries — a rider's own session can never fetch
// another rider's orders, even by tampering with a request.
export const GET = defineHandler({ permission: "delivery.riderApp.access" }, async ({ session }) => {
  const orders = await listMyDeliveries(session.tenantId, session.id);
  return { orders };
});
