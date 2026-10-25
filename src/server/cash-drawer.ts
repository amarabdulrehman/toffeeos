import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { businessDayRange, isBusinessDay, todayFor } from "@/lib/business-day";

/**
 * The cash drawer: what a branch started the day with, and what was actually in it at close.
 *
 * Only CASH touches the drawer. Card, JazzCash, Easypaisa and bank transfers are real revenue but
 * they never pass through the till, so counting them here would guarantee a variance every single
 * day and train everyone to ignore the number — which defeats the entire point of counting.
 *
 * The expected balance is derived on every read rather than stored. A payment or expense recorded
 * late (a common thing) lands on the business day it belongs to, and a stored expectation would
 * silently go stale the moment that happened. The variance is the whole product here, so it has to
 * be computed from what is true now.
 */

export interface CashDrawerDayView {
  id: string | null;
  businessDate: string;
  branchId: string;
  branchName: string;
  isOpen: boolean;
  openingBalancePaisa: number | null;
  openedByName: string | null;
  openedAt: string | null;
  cashSalesPaisa: number;
  cashExpensesPaisa: number;
  /** Cash handed back to customers today. Out of the drawer, exactly like a cash expense. */
  cashRefundsPaisa: number;
  /** opening + cash in - cash out. Null until the day is opened, since there is no float to add to. */
  expectedClosingPaisa: number | null;
  closingCountedPaisa: number | null;
  closedByName: string | null;
  closedAt: string | null;
  /** counted - expected. Positive is over, negative is short. Null until the day is closed. */
  variancePaisa: number | null;
  correctedByName: string | null;
  correctedAt: string | null;
  note: string | null;
  /** Every time the drawer was opened with no sale this day: who, when, and why. */
  noSales: { at: string; byName: string | null; reason: string }[];
  /**
   * The day's takings by every way of paying, side by side, for closing up. Shown beside the
   * drawer, never counted in it: only cash is in the drawer. The card figure is the one to check
   * against the card machine's end-of-day slip. Only on a single day's view, not the history list.
   */
  takings?: {
    byMethod: { method: string; amountPaisa: number }[];
    refundsByMethod: { method: string; amountPaisa: number }[];
    /** Given free today, at menu value. Not money taken. */
    complimentary: { itemCount: number; valuePaisa: number };
  };
}

async function branchOrThrow(tenantId: string, branchId: string) {
  const branch = await tenantDb(tenantId).branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, timezone: true, settings: { select: { dayStartMinutes: true } } },
  });
  if (!branch) throw new HttpError(404, "That branch doesn't exist.");
  // A drawer opened at 6pm and counted at 1:30am is one day's drawer, not two.
  return { ...branch, dayStartMinutes: branch.settings?.dayStartMinutes ?? 0 };
}

async function resolveNames(tenantId: string, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return new Map<string, string>();
  const users = await tenantDb(tenantId).user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Cash that physically entered and left the drawer on a business day, in the branch's timezone. */
async function cashMovement(tenantId: string, branchId: string, day: string, timezone: string, dayStartMinutes: number) {
  const db = tenantDb(tenantId);
  const { from, to } = businessDayRange(day, timezone, dayStartMinutes);

  const [payments, expenses, refunds] = await Promise.all([
    // Joined through the order so a cancelled order's takings don't count as cash on hand. Dated by
    // paidAt (when the money arrived), never createdAt, matching paidOrdersWhere in reports.ts.
    db.payment.findMany({
      where: {
        method: "CASH",
        order: { branchId, status: "PAID", paidAt: { gte: from, lte: to } },
      },
      select: { amountPaisa: true },
    }),
    // Only APPROVED - a pending expense is a claim, not money that has left the till.
    db.expense.findMany({
      where: { branchId, method: "CASH", status: "APPROVED", spentAt: { gte: from, lte: to } },
      select: { amountPaisa: true },
    }),
    // Cash handed back comes out of the drawer exactly like a cash expense does. Dated by when the
    // refund happened, not by when the order was paid: refunding yesterday's lunch takes money out
    // of today's till, and a drawer that counted it against yesterday would show short today and
    // over yesterday, with nothing to explain either.
    db.refund.findMany({
      where: { method: "CASH", createdAt: { gte: from, lte: to }, order: { branchId, status: { not: "DELETED" } } },
      select: { amountPaisa: true },
    }),
  ]);

  return {
    cashSalesPaisa: payments.reduce((a, p) => a + p.amountPaisa, 0),
    cashExpensesPaisa: expenses.reduce((a, e) => a + e.amountPaisa, 0),
    cashRefundsPaisa: refunds.reduce((a, r) => a + r.amountPaisa, 0),
  };
}

/** Everything taken on a business day, by method, with refunds and what was given free. Dated the
 * same way as the drawer: payments by paidAt, refunds by when they happened. */
async function takingsOn(tenantId: string, branchId: string, from: Date, to: Date): Promise<NonNullable<CashDrawerDayView["takings"]>> {
  const db = tenantDb(tenantId);
  const [payments, refunds, comps] = await Promise.all([
    db.payment.groupBy({
      by: ["method"],
      where: { order: { branchId, status: "PAID", paidAt: { gte: from, lte: to } } },
      _sum: { amountPaisa: true },
    }),
    db.refund.groupBy({
      by: ["method"],
      where: { createdAt: { gte: from, lte: to }, order: { branchId, status: { not: "DELETED" } } },
      _sum: { amountPaisa: true },
    }),
    db.orderLine.aggregate({
      where: { isComplimentary: true, isVoided: false, order: { branchId, status: "PAID", paidAt: { gte: from, lte: to } } },
      _sum: { quantity: true, compValuePaisa: true },
    }),
  ]);
  const rows = (g: { method: string; _sum: { amountPaisa: number | null } }[]) =>
    g
      .map((r) => ({ method: r.method, amountPaisa: r._sum.amountPaisa ?? 0 }))
      .filter((r) => r.amountPaisa > 0)
      .sort((a, b) => b.amountPaisa - a.amountPaisa);
  return {
    byMethod: rows(payments),
    refundsByMethod: rows(refunds),
    complimentary: { itemCount: comps._sum.quantity ?? 0, valuePaisa: comps._sum.compValuePaisa ?? 0 },
  };
}

/**
 * The drawer for one branch on one business day. Returns a fully-formed view even when no drawer
 * has been opened yet — the UI needs to show the day's cash movement either way, and "nobody has
 * opened the drawer but Rs 40,000 has gone through it" is exactly the situation worth surfacing.
 */
export async function getDrawerDay(tenantId: string, branchId: string, day?: string): Promise<CashDrawerDayView> {
  const branch = await branchOrThrow(tenantId, branchId);
  const businessDate = day ?? todayFor(branch.timezone, new Date(), branch.dayStartMinutes);
  if (!isBusinessDay(businessDate)) throw new HttpError(400, "That isn't a valid date.");

  const db = tenantDb(tenantId);
  const { from, to } = businessDayRange(businessDate, branch.timezone, branch.dayStartMinutes);
  const [row, movement, noSales, takings] = await Promise.all([
    db.cashDrawerDay.findUnique({ where: { branchId_businessDate: { branchId, businessDate } } }),
    cashMovement(tenantId, branchId, businessDate, branch.timezone, branch.dayStartMinutes),
    db.noSaleOpening.findMany({ where: { branchId, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" } }),
    takingsOn(tenantId, branchId, from, to),
  ]);

  const names = await resolveNames(tenantId, [row?.openedById, row?.closedById, row?.correctedById, ...noSales.map((n) => n.openedById)]);
  const expectedClosingPaisa =
    row == null
      ? null
      : row.openingBalancePaisa + movement.cashSalesPaisa - movement.cashExpensesPaisa - movement.cashRefundsPaisa;

  return {
    id: row?.id ?? null,
    businessDate,
    branchId,
    branchName: branch.name,
    isOpen: row != null && row.closedAt == null,
    openingBalancePaisa: row?.openingBalancePaisa ?? null,
    openedByName: row ? (names.get(row.openedById) ?? null) : null,
    openedAt: row?.openedAt.toISOString() ?? null,
    ...movement,
    expectedClosingPaisa,
    closingCountedPaisa: row?.closingCountedPaisa ?? null,
    closedByName: row?.closedById ? (names.get(row.closedById) ?? null) : null,
    closedAt: row?.closedAt?.toISOString() ?? null,
    variancePaisa:
      row?.closingCountedPaisa != null && expectedClosingPaisa != null
        ? row.closingCountedPaisa - expectedClosingPaisa
        : null,
    correctedByName: row?.correctedById ? (names.get(row.correctedById) ?? null) : null,
    correctedAt: row?.correctedAt?.toISOString() ?? null,
    note: row?.note ?? null,
    noSales: noSales.map((n) => ({ at: n.createdAt.toISOString(), byName: names.get(n.openedById) ?? null, reason: n.reason })),
    takings,
  };
}

/**
 * The drawer was opened with no sale. There is no hardware to open from a browser, so what this
 * does is put it on record — who, when and why — against the day's drawer, where whoever counts the
 * drawer tonight will see it. The POS then offers a slip to print, which opens the drawer on
 * printers set to kick it with every print.
 */
export async function recordNoSale(tenantId: string, branchId: string, actorId: string, reason: string) {
  await branchOrThrow(tenantId, branchId);
  return tenantDb(tenantId).noSaleOpening.create({
    data: { tenantId, branchId, openedById: actorId, reason: reason.trim() },
  });
}

export async function openDrawerDay(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { openingBalancePaisa: number; businessDate?: string; note?: string | null }
): Promise<CashDrawerDayView> {
  const branch = await branchOrThrow(tenantId, branchId);
  const businessDate = input.businessDate ?? todayFor(branch.timezone, new Date(), branch.dayStartMinutes);
  if (!isBusinessDay(businessDate)) throw new HttpError(400, "That isn't a valid date.");
  if (!Number.isInteger(input.openingBalancePaisa) || input.openingBalancePaisa < 0) {
    throw new HttpError(400, "The opening balance can't be negative.");
  }

  const existing = await tenantDb(tenantId).cashDrawerDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate } },
  });
  // Reopening would silently rewrite the float the day was reconciled against, so it is refused
  // rather than merged. The unique index backs this up if two cashiers race each other.
  if (existing) throw new HttpError(409, "The drawer for this day has already been opened.");

  await tenantDb(tenantId).cashDrawerDay.create({
    data: {
      tenantId,
      branchId,
      businessDate,
      openingBalancePaisa: input.openingBalancePaisa,
      openedById: actorId,
      note: input.note?.trim() || null,
    },
  });

  return getDrawerDay(tenantId, branchId, businessDate);
}

export interface CloseDrawerDayResult {
  day: CashDrawerDayView;
  /** Distinguishes a correction from an ordinary first close, so the route can audit-log the right
   * action name and the previous figure a correction overwrote. */
  isCorrection: boolean;
  previousClosingCountedPaisa: number | null;
}

export async function closeDrawerDay(
  tenantId: string,
  branchId: string,
  actorId: string,
  permissions: readonly string[],
  input: { closingCountedPaisa: number; businessDate?: string; note?: string | null }
): Promise<CloseDrawerDayResult> {
  const branch = await branchOrThrow(tenantId, branchId);
  const businessDate = input.businessDate ?? todayFor(branch.timezone, new Date(), branch.dayStartMinutes);
  if (!isBusinessDay(businessDate)) throw new HttpError(400, "That isn't a valid date.");
  if (!Number.isInteger(input.closingCountedPaisa) || input.closingCountedPaisa < 0) {
    throw new HttpError(400, "The counted amount can't be negative.");
  }

  const existing = await tenantDb(tenantId).cashDrawerDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate } },
  });
  if (!existing) throw new HttpError(400, "This day's drawer was never opened, so there's nothing to close.");

  const isCorrection = existing.closedAt != null;
  // An ordinary second close would silently overwrite the first count and erase whatever variance
  // was already investigated — refused for anyone without the dedicated correction permission.
  // pos.cashDrawer.correctClose is Owner/Branch Manager only (see registry.ts): the person who did
  // the original close can't quietly redo it, only someone reviewing it after the fact can correct
  // it, and closedById/closedAt below are left untouched either way so the record of who actually
  // closed the till never changes.
  if (isCorrection && !permissions.includes("pos.cashDrawer.correctClose")) {
    throw new HttpError(409, "This day has already been closed.");
  }

  await tenantDb(tenantId).cashDrawerDay.update({
    where: { id: existing.id },
    data: isCorrection
      ? {
          closingCountedPaisa: input.closingCountedPaisa,
          correctedById: actorId,
          correctedAt: new Date(),
          note: input.note?.trim() || existing.note,
        }
      : {
          closingCountedPaisa: input.closingCountedPaisa,
          closedById: actorId,
          closedAt: new Date(),
          note: input.note?.trim() || existing.note,
        },
  });

  return {
    day: await getDrawerDay(tenantId, branchId, businessDate),
    isCorrection,
    previousClosingCountedPaisa: isCorrection ? existing.closingCountedPaisa : null,
  };
}

/** Recent days for one branch, newest first — the history strip under today's drawer. */
export async function listDrawerDays(tenantId: string, branchId: string, limit = 30): Promise<CashDrawerDayView[]> {
  await branchOrThrow(tenantId, branchId);
  const rows = await tenantDb(tenantId).cashDrawerDay.findMany({
    where: { branchId },
    orderBy: { businessDate: "desc" },
    take: Math.min(Math.max(limit, 1), 90),
    select: { businessDate: true },
  });
  // Sequential rather than parallel: each day re-queries its own cash movement, and a branch with
  // 90 days of history would otherwise open 180 connections at once.
  const out: CashDrawerDayView[] = [];
  for (const row of rows) out.push(await getDrawerDay(tenantId, branchId, row.businessDate));
  return out;
}
