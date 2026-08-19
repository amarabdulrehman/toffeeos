import { defineHandler } from "@/server/handler";
import { listDeliveryBoard } from "@/server/delivery";

export const GET = defineHandler({ permission: "delivery.view" }, async ({ session }) => {
  const board = await listDeliveryBoard(session.tenantId, session.branchId);
  return board;
});
