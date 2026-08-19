import { defineHandler } from "@/server/handler";
import { markLineReady } from "@/server/orders";

export const POST = defineHandler({ permission: "kds.item.markReady" }, async ({ session, params }) => {
  const line = await markLineReady(session.tenantId, session.branchId, params.lineId, session.id);
  return { line };
});
