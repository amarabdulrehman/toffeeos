import { z } from "zod";
import { defineHandler } from "@/server/handler";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// GET /api/reports/item-wise?from=...&to=... — quantity sold and revenue per menu item across
// paid orders in the range, highest revenue first.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, db, input }) => {
  const orders = await db.order.findMany({
    where: {
      branchId: session.branchId,
      status: "PAID",
      paidAt: { gte: new Date(input.from), lte: new Date(input.to) },
    },
    select: { lines: { where: { isVoided: false }, select: { menuItemId: true, nameSnapshot: true, quantity: true, lineTotalPaisa: true } } },
  });

  const byItem = new Map<string, { name: string; quantity: number; revenuePaisa: number }>();
  for (const order of orders) {
    for (const line of order.lines) {
      const entry = byItem.get(line.menuItemId) ?? { name: line.nameSnapshot, quantity: 0, revenuePaisa: 0 };
      entry.quantity += line.quantity;
      entry.revenuePaisa += line.lineTotalPaisa;
      byItem.set(line.menuItemId, entry);
    }
  }

  return {
    items: Array.from(byItem.entries())
      .map(([menuItemId, v]) => ({ menuItemId, ...v }))
      .sort((a, b) => b.revenuePaisa - a.revenuePaisa),
  };
});
