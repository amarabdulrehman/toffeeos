import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { orderActivity } from "@/server/order-activity";

const schema = z.object({
  /** The `now` from the caller's previous answer. Omitted on a till's first look. */
  since: z.string().datetime().optional(),
});

// GET /api/orders/activity — what's new at this branch since the till last looked: new orders, rounds
// added to tables, orders the kitchen has marked ready. Every till asks, so pos.access, not
// orders.view — a waiter's phone needs its own "your order is ready".
export const GET = defineHandler({ permission: "pos.access", input: schema }, async ({ session, input }) => {
  return orderActivity(session.tenantId, session.branchId, input.since ? new Date(input.since) : null);
});
