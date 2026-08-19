import { z } from "zod";
import { defineHandler } from "@/server/handler";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// GET /api/reports/sales-summary?from=...&to=... — paid-order totals for the range, plus a
// per-day breakdown for a simple trend chart.
export const GET = defineHandler({ permission: "reports.sales.view", input: querySchema }, async ({ session, db, input }) => {
  const orders = await db.order.findMany({
    where: {
      branchId: session.branchId,
      status: "PAID",
      paidAt: { gte: new Date(input.from), lte: new Date(input.to) },
    },
    select: {
      paidAt: true,
      subtotalPaisa: true,
      serviceChargePaisa: true,
      taxPaisa: true,
      discountedSubtotalPaisa: true,
      totalPaisa: true,
    },
  });

  const byDay = new Map<string, { orders: number; totalPaisa: number }>();
  let totalPaisa = 0;
  let subtotalPaisa = 0;
  let taxPaisa = 0;
  let serviceChargePaisa = 0;

  for (const o of orders) {
    totalPaisa += o.totalPaisa;
    subtotalPaisa += o.discountedSubtotalPaisa;
    taxPaisa += o.taxPaisa;
    serviceChargePaisa += o.serviceChargePaisa;
    const day = (o.paidAt ?? new Date()).toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { orders: 0, totalPaisa: 0 };
    entry.orders += 1;
    entry.totalPaisa += o.totalPaisa;
    byDay.set(day, entry);
  }

  return {
    orderCount: orders.length,
    totalPaisa,
    subtotalPaisa,
    taxPaisa,
    serviceChargePaisa,
    byDay: Array.from(byDay.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
});
