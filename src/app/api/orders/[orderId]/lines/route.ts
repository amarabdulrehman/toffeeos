import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { addLinesToOrder, assertDiscountPermission } from "@/server/orders";
import { ordersNeedApproval, requestMoreItemsApproval } from "@/server/order-approvals";

// Same line shape POST /api/orders already uses (src/app/api/orders/route.ts) — kept in sync by
// hand since Zod schemas aren't shared across route files in this codebase.
const discountSchema = z.object({ type: z.enum(["PERCENT", "FIXED"]), value: z.number().int().nonnegative() });
const lineSchema = z.object({
  menuItemId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  modifierIds: z.array(z.string().min(1)).optional(),
  quantity: z.number().int().positive(),
  notes: z.string().max(280).optional(),
  discount: discountSchema.optional(),
});

const addLinesSchema = z.object({ lines: z.array(lineSchema).min(1) });

// POST /api/orders/[orderId]/lines — appends items to an order that's already been sent to the
// kitchen. Reuses addLinesToOrder (src/server/orders.ts), the exact machinery QR table-ordering
// already relies on for a guest's second round — this just finally exposes it to POS staff too
// (see the "Add items" action on ResumedOrderPanel, src/components/pos/tables-dialog.tsx). Online
// only for now: this isn't one of the offline queue's three action types
// (src/lib/offline/queue.ts), so it's not attempted while offline.
export const POST = defineHandler(
  { permission: "pos.order.editItems", input: addLinesSchema },
  async ({ session, params, input }) => {
    assertDiscountPermission(session, undefined, input.lines);
    // Held for the counter in a branch that asks for it: nothing is added until it is approved.
    if (await ordersNeedApproval(session.tenantId, session.branchId, session.permissions)) {
      return requestMoreItemsApproval(session.tenantId, session.branchId, params.orderId, input.lines, session.id);
    }
    const order = await addLinesToOrder(
      session.tenantId,
      session.branchId,
      params.orderId,
      input.lines,
      session.id,
      session.permissions.includes("pos.discount.exceedMax")
    );
    return { order, awaitingApproval: false };
  }
);
