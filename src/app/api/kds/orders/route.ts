import { defineHandler } from "@/server/handler";

// GET /api/kds/orders — active kitchen orders.
//
// Deliberately NOT just `status: { in: ["SENT_TO_KITCHEN", "READY"] } }` — taking payment moves
// `status` straight to PAID (see takePayment in orders.ts) regardless of kitchen progress, since
// payment and kitchen fulfillment are two independent lifecycles that both happen to be recorded
// on the same `status` column. A restaurant that collects payment upfront (common for
// takeaway/counter service) would otherwise have its ticket vanish from the kitchen the instant
// it's paid, even if the food hasn't been touched yet. There's no separate "served" step wired up
// anywhere in the UI today (the /serve route exists but nothing calls it), so in practice payment
// is *also* how staff clear a finished ticket off this board once the kitchen has already marked
// it ready — that behavior is intentionally preserved. The one thing that must never happen is an
// order disappearing before the kitchen got to mark it ready, so a paid order still shows here as
// long as readyAt is still null; markOrderReady preserves status "PAID" (rather than regressing it
// to READY) precisely so this readyAt check keeps working after payment.
// A paid order whose ticket was never marked ready stays on the board, but only for this long. With
// no limit, a café that pays orders without tapping Ready had every such order since it opened on
// its board, and every kitchen screen downloaded all of them again every 15 seconds — database
// traffic that grew by the day (the hosting account went over its monthly quota in November 2026).
// A kitchen doesn't cook from yesterday's tickets.
const PAID_UNREADY_WINDOW_MS = 12 * 60 * 60 * 1000;

export const GET = defineHandler({ permission: "kds.access" }, async ({ session, db }) => {
  const orders = await db.order.findMany({
    where: {
      branchId: session.branchId,
      sentToKitchenAt: { not: null },
      status: { notIn: ["DELIVERED", "VOIDED", "CANCELLED", "DELETED"] },
      OR: [
        { status: { in: ["SENT_TO_KITCHEN", "READY"] } },
        { readyAt: null, sentToKitchenAt: { gte: new Date(Date.now() - PAID_UNREADY_WINDOW_MS) } },
      ],
    },
    orderBy: { sentToKitchenAt: "asc" },
    include: {
      lines: { include: { modifiers: true } },
      table: true,
    },
  });
  return { orders };
});
