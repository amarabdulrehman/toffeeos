import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { recordNoSale } from "@/server/cash-drawer";

const schema = z.object({
  reason: z.string().trim().min(2, "Say why the drawer is being opened.").max(200),
});

// POST /api/cash-drawer/no-sale — the drawer was opened with no sale. Always the caller's own
// branch: it is the till in front of them.
export const POST = defineHandler(
  {
    permission: "pos.cashDrawer.openNoSale",
    input: schema,
    audit: (input) => ({ action: "cash.drawer.noSale", entityType: "NoSaleOpening", metadata: { reason: input.reason } }),
  },
  async ({ session, input }) => {
    const opening = await recordNoSale(session.tenantId, session.branchId, session.id, input.reason);
    return { opening: { id: opening.id, at: opening.createdAt.toISOString(), reason: opening.reason } };
  }
);
