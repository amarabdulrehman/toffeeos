import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { reverseAdjustment } from "@/server/purchasing";

const schema = z.object({ reason: z.string().min(1).max(200) });

// POST /api/inventory/adjustment/[movementId]/reverse — undo a stock adjustment made in error, by
// writing the opposite movement. Nothing is deleted.
export const POST = defineHandler(
  {
    permission: "inventory.adjustment.delete",
    input: schema,
    audit: (input) => ({ action: "inventory.adjustment.reverse", entityType: "StockMovement", metadata: { reason: input.reason } }),
  },
  async ({ session, params, input }) => {
    await reverseAdjustment(session.tenantId, session.id, params.movementId, input.reason);
    return { ok: true };
  }
);
