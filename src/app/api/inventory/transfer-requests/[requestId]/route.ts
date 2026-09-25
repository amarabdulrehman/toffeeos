import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { decideTransferRequest } from "@/server/purchasing";

const schema = z.discriminatedUnion("approve", [
  z.object({ approve: z.literal(true) }),
  z.object({ approve: z.literal(false), reason: z.string().min(1).max(200) }),
]);

// POST /api/inventory/transfer-requests/[requestId] — approve (the stock moves now) or turn down.
export const POST = defineHandler(
  {
    permission: "inventory.transfer.approve",
    input: schema,
    audit: (input) => ({ action: input.approve ? "transfer.approve" : "transfer.reject", entityType: "StockTransferRequest", metadata: { ...input } }),
  },
  async ({ session, params, input }) => {
    return { request: await decideTransferRequest(session.tenantId, session.id, params.requestId, input) };
  }
);
