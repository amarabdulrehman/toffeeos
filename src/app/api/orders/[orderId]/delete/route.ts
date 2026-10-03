import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { deleteOrder } from "@/server/order-deletion";
import { getTenantModules } from "@/server/tier";

const deleteSchema = z.object({
  reason: z.string().trim().min(3).max(280),
  password: z.string().min(1).max(200),
  restock: z.boolean().default(false),
});

// POST /api/orders/[orderId]/delete — the owner removes an order from the books. Everything that
// makes this safe lives in deleteOrder (owner-only by the database, password re-entered, refused
// while impersonating, permanent log); this route adds the per-restaurant switch, which only a
// platform admin can turn on. orders.view is the floor every owner holds — it is not what
// authorises the delete.
export const POST = defineHandler(
  {
    permission: "orders.view",
    input: deleteSchema,
    // Never the password. Spelled out field by field so a new input can't leak into the log.
    audit: (input, result) => {
      const r = result as { deletion: { orderNumber: number; totalPaisa: number; restocked: boolean } };
      return {
        action: "order.delete",
        entityType: "Order",
        metadata: {
          orderNumber: r.deletion.orderNumber,
          totalPaisa: r.deletion.totalPaisa,
          reason: input.reason,
          restocked: r.deletion.restocked,
        },
      };
    },
  },
  async ({ session, db, params, input }) => {
    const modules = await getTenantModules(db);
    if (!modules.includes("orderDelete")) {
      throw new HttpError(403, "Deleting orders isn't turned on for this restaurant. Ask your ToffeeOS administrator.");
    }
    const deletion = await deleteOrder(
      session.tenantId,
      { userId: session.id, impersonatedByPlatformUserId: session.impersonatedByPlatformUserId },
      params.orderId,
      input
    );
    return { deletion };
  }
);
