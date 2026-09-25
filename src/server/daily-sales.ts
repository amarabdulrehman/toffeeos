import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { paidOrdersWhere, reportClock, type DateRange } from "@/server/reports";
import type { BranchClock } from "@/server/branch-settings";
import { addDays, businessDayOf, businessDayRange, isBusinessDay, todayFor } from "@/lib/business-day";
import type { DayReport, PeriodDay, PeriodReport, SalesTotals } from "@/lib/daily-sales";

/**
 * Daily Sales: what a day took, in enough detail to close it, and the same for a week or a month
 * with every day listed.
 *
 * Built on the Sales report's own definition of a sale — a PAID order, dated by when the money came
 * in (paidOrdersWhere) — and its own treatment of refunds, which come off the day the refunded order
 * was paid. So the net figure here and the Sales tab's net for the same dates are the same number,
 * by construction; daily-sales.spec.ts asserts it. Days are the branch's business days, which may
 * end after midnight (BranchSettings.dayStartMinutes).
 */

/** Longest period one request will total. A quarter is plenty for a closing; a year is a report. */
export const MAX_PERIOD_DAYS = 93;

const ORDER_SELECT = {
  id: true,
  type: true,
  totalPaisa: true,
  refundedPaisa: true,
  taxPaisa: true,
  serviceChargePaisa: true,
  discountedSubtotalPaisa: true,
  paidAt: true,
  createdById: true,
  lines: { select: { menuItemId: true, nameSnapshot: true, quantity: true, lineTotalPaisa: true, isVoided: true } },
  payments: { select: { method: true, amountPaisa: true } },
} as const;

type PaidOrder = {
  id: string;
  type: string;
  totalPaisa: number;
  refundedPaisa: number;
  taxPaisa: number;
  serviceChargePaisa: number;
  discountedSubtotalPaisa: number;
  paidAt: Date | null;
  createdById: string | null;
  lines: { menuItemId: string; nameSnapshot: string; quantity: number; lineTotalPaisa: number; isVoided: boolean }[];
  payments: { method: string; amountPaisa: number }[];
};

/**
 * Discounts on one order. Its stored subtotal is already net of line discounts, so the lines' own
 * full-price sum is the starting point — that way a discount on a single item counts as much as one
 * on the whole order. (Every order has stored its discounted subtotal since the first migration.)
 */
function discountOn(o: PaidOrder): number {
  const linesGross = o.lines.filter((l) => !l.isVoided).reduce((sum, l) => sum + l.lineTotalPaisa, 0);
  return Math.max(0, linesGross - o.discountedSubtotalPaisa);
}

function totalsOf(orders: PaidOrder[]): SalesTotals {
  const byMethod = new Map<string, number>();
  const byType = new Map<string, { orderCount: number; grossPaisa: number }>();
  let grossPaisa = 0;
  let refundedPaisa = 0;
  let taxPaisa = 0;
  let serviceChargePaisa = 0;
  let discountPaisa = 0;

  for (const o of orders) {
    grossPaisa += o.totalPaisa;
    refundedPaisa += o.refundedPaisa;
    taxPaisa += o.taxPaisa;
    serviceChargePaisa += o.serviceChargePaisa;
    discountPaisa += discountOn(o);
    for (const p of o.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountPaisa);
    const t = byType.get(o.type) ?? { orderCount: 0, grossPaisa: 0 };
    t.orderCount += 1;
    t.grossPaisa += o.totalPaisa;
    byType.set(o.type, t);
  }

  const netPaisa = grossPaisa - refundedPaisa;
  return {
    orderCount: orders.length,
    grossPaisa,
    refundedPaisa,
    netPaisa,
    averageOrderPaisa: orders.length > 0 ? Math.round(netPaisa / orders.length) : 0,
    taxPaisa,
    serviceChargePaisa,
    discountPaisa,
    byPaymentMethod: [...byMethod.entries()]
      .map(([method, amountPaisa]) => ({ method, amountPaisa }))
      .sort((a, b) => b.amountPaisa - a.amountPaisa),
    byOrderType: [...byType.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.grossPaisa - a.grossPaisa),
  };
}

async function paidOrdersIn(tenantId: string, branchIds: string[], range: DateRange): Promise<PaidOrder[]> {
  return tenantDb(tenantId).order.findMany({
    where: paidOrdersWhere(branchIds, range),
    select: ORDER_SELECT,
  });
}

function rangeFor(day: string, clock: BranchClock): DateRange {
  return { ...businessDayRange(day, clock.timezone, clock.dayStartMinutes), ...clock };
}

export async function dayReport(tenantId: string, branchIds: string[], requestedDay?: string): Promise<DayReport> {
  const clock = await reportClock(tenantId, branchIds);
  const today = todayFor(clock.timezone, new Date(), clock.dayStartMinutes);
  const day = requestedDay ?? today;
  if (!isBusinessDay(day)) throw new HttpError(400, "That isn't a valid date.");
  if (day > today) throw new HttpError(400, "That day hasn't happened yet.");

  const range = rangeFor(day, clock);
  const isToday = day === today;
  const db = tenantDb(tenantId);

  // Today is compared with yesterday *up to the same time*, not with all of yesterday: at 2pm a
  // full day behind would always look like a bad day. Any other day is compared with the one before.
  const yesterday = rangeFor(addDays(day, -1), clock);
  const compareRange: DateRange = isToday
    ? { ...yesterday, to: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    : yesterday;

  const [orders, compareOrders, voidEvents, openOrders] = await Promise.all([
    paidOrdersIn(tenantId, branchIds, range),
    db.order.findMany({ where: paidOrdersWhere(branchIds, compareRange), select: { totalPaisa: true, refundedPaisa: true } }),
    db.orderEvent.findMany({
      where: { type: "VOIDED", createdAt: { gte: range.from, lte: range.to }, order: { branchId: { in: branchIds } } },
      select: { order: { select: { totalPaisa: true } } },
    }),
    db.order.findMany({
      where: {
        branchId: { in: branchIds },
        status: { notIn: ["PAID", "VOIDED", "CANCELLED"] },
        createdAt: { gte: range.from, lte: range.to },
      },
      select: { totalPaisa: true },
    }),
  ]);

  const byHourMap = new Map<number, { orderCount: number; grossPaisa: number }>();
  const byItem = new Map<string, { name: string; quantity: number; revenuePaisa: number }>();
  const byStaffMap = new Map<string, { orderCount: number; netPaisa: number }>();
  for (const o of orders) {
    const hour = Number(formatInTimeZone(o.paidAt ?? new Date(), clock.timezone, "H"));
    const h = byHourMap.get(hour) ?? { orderCount: 0, grossPaisa: 0 };
    h.orderCount += 1;
    h.grossPaisa += o.totalPaisa;
    byHourMap.set(hour, h);

    for (const l of o.lines) {
      if (l.isVoided) continue;
      const item = byItem.get(l.menuItemId) ?? { name: l.nameSnapshot, quantity: 0, revenuePaisa: 0 };
      item.quantity += l.quantity;
      item.revenuePaisa += l.lineTotalPaisa;
      byItem.set(l.menuItemId, item);
    }

    const staffId = o.createdById ?? "unknown";
    const s = byStaffMap.get(staffId) ?? { orderCount: 0, netPaisa: 0 };
    s.orderCount += 1;
    s.netPaisa += o.totalPaisa - o.refundedPaisa;
    byStaffMap.set(staffId, s);
  }

  const staffIds = [...byStaffMap.keys()].filter((id) => id !== "unknown");
  const users = staffIds.length
    ? await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  // A 4am day runs 4, 5, … 23, 0, 1, 2, 3 — list the hours in that order, not from midnight.
  const startHour = Math.floor(clock.dayStartMinutes / 60);
  const byHour = [...byHourMap.entries()]
    .map(([hour, v]) => ({ hour, ...v }))
    .sort((a, b) => ((a.hour - startHour + 24) % 24) - ((b.hour - startHour + 24) % 24));

  return {
    day,
    isToday,
    dayStartMinutes: clock.dayStartMinutes,
    totals: totalsOf(orders),
    byHour,
    topItems: [...byItem.values()].sort((a, b) => b.revenuePaisa - a.revenuePaisa).slice(0, 10),
    byStaff: [...byStaffMap.entries()]
      .map(([id, v]) => ({ name: nameOf.get(id) ?? "Unknown", ...v }))
      .sort((a, b) => b.netPaisa - a.netPaisa),
    voids: {
      count: voidEvents.length,
      valuePaisa: voidEvents.reduce((sum, v) => sum + v.order.totalPaisa, 0),
    },
    openOrders: { count: openOrders.length, valuePaisa: openOrders.reduce((sum, o) => sum + o.totalPaisa, 0) },
    compare: {
      label: isToday ? "same time yesterday" : "the day before",
      orderCount: compareOrders.length,
      netPaisa: compareOrders.reduce((sum, o) => sum + o.totalPaisa - o.refundedPaisa, 0),
    },
  };
}

export async function periodReport(tenantId: string, branchIds: string[], from: string, to: string): Promise<PeriodReport> {
  if (!isBusinessDay(from) || !isBusinessDay(to)) throw new HttpError(400, "That isn't a valid date.");
  if (from > to) throw new HttpError(400, "The start date is after the end date.");

  const dayList: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dayList.push(d);
    if (dayList.length > MAX_PERIOD_DAYS) {
      throw new HttpError(400, `Pick a period of ${MAX_PERIOD_DAYS} days or fewer.`);
    }
  }

  const clock = await reportClock(tenantId, branchIds);
  const range: DateRange = {
    from: businessDayRange(from, clock.timezone, clock.dayStartMinutes).from,
    to: businessDayRange(to, clock.timezone, clock.dayStartMinutes).to,
    ...clock,
  };
  // Compared with the same number of days immediately before. A period still under way is compared
  // up to the same point — the last seven days at 2pm against the seven before them at 2pm — or
  // today's half-finished day would always make the period look worse than the one before it.
  const n = dayList.length;
  const today = todayFor(clock.timezone, new Date(), clock.dayStartMinutes);
  const underWay = to >= today;
  const previous: DateRange = {
    from: businessDayRange(addDays(from, -n), clock.timezone, clock.dayStartMinutes).from,
    to: underWay
      ? new Date(Date.now() - n * 24 * 60 * 60 * 1000)
      : businessDayRange(addDays(from, -1), clock.timezone, clock.dayStartMinutes).to,
    ...clock,
  };

  const [orders, compareOrders] = await Promise.all([
    paidOrdersIn(tenantId, branchIds, range),
    tenantDb(tenantId).order.findMany({
      where: paidOrdersWhere(branchIds, previous),
      select: { totalPaisa: true, refundedPaisa: true },
    }),
  ]);

  const perDay = new Map<string, PeriodDay>(
    dayList.map((day) => [
      day,
      { day, orderCount: 0, grossPaisa: 0, refundedPaisa: 0, netPaisa: 0, taxPaisa: 0, cashPaisa: 0, cardPaisa: 0, otherPaisa: 0 },
    ])
  );
  for (const o of orders) {
    const row = perDay.get(businessDayOf(o.paidAt ?? new Date(), clock.timezone, clock.dayStartMinutes));
    if (!row) continue;
    row.orderCount += 1;
    row.grossPaisa += o.totalPaisa;
    row.refundedPaisa += o.refundedPaisa;
    row.netPaisa += o.totalPaisa - o.refundedPaisa;
    row.taxPaisa += o.taxPaisa;
    for (const p of o.payments) {
      if (p.method === "CASH") row.cashPaisa += p.amountPaisa;
      else if (p.method === "CARD") row.cardPaisa += p.amountPaisa;
      else row.otherPaisa += p.amountPaisa;
    }
  }

  const span = n === 1 ? "the day before" : `the ${n} days before`;
  return {
    from,
    to,
    dayStartMinutes: clock.dayStartMinutes,
    totals: totalsOf(orders),
    days: [...perDay.values()],
    compare: {
      label: underWay ? `${span}, to the same time` : span,
      orderCount: compareOrders.length,
      netPaisa: compareOrders.reduce((sum, o) => sum + o.totalPaisa - o.refundedPaisa, 0),
    },
  };
}
