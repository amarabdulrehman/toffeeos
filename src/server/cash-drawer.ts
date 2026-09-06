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
  /** opening + cash in - cash out. Null until the day is opened, since there is no float to add to. */
  expectedClosingPaisa: number | null;
  closingCountedPaisa: number | null;
  closedByName: string | null;
  closedAt: string | null;
  /** counted - expected. Positive is over, negative is short. Null until the day is closed. */
  variancePaisa: number | null;
  note: string | null;
}

async function branchOrThrow(tenantId: string, branchId: string) {
  const branch = await tenantDb(tenantId).branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, timezone: true },
  });
  if (!branch) throw new HttpError(404, "That branch doesn't exist.");
  return branch;
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
async function cashMovement(tenantId: string, branchId: string, day: string, timezone: string) {
  const db = tenantDb(tenantId);
  const { from, to } = businessDayRange(day, timezone);

  const [payments, expenses] = await Promise.all([
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
  ]);

  return {
    cashSalesPaisa: payments.reduce((a, p) => a + p.amountPaisa, 0),
    cashExpensesPaisa: expenses.reduce((a, e) => a + e.amountPaisa, 0),
  };
}

/**
 * The drawer for one branch on one business day. Returns a fully-formed view even when no drawer
 * has been opened yet — the UI needs to show the day's cash movement either way, and "nobody has
 * opened the drawer but Rs 40,000 has gone through it" is exactly the situation worth surfacing.
 */
export async function getDrawerDay(tenantId: string, branchId: string, day?: string): Promise<CashDrawerDayView> {
  const branch = await branchOrThrow(tenantId, branchId);
  const businessDate = day ?? todayFor(branch.timezone);
  if (!isBusinessDay(businessDate)) throw new HttpError(400, "That isn't a valid date.");

  const db = tenantDb(tenantId);
  const [row, movement] = await Promise.all([
    db.cashDrawerDay.findUnique({ where: { branchId_businessDate: { branchId, businessDate } } }),
    cashMovement(tenantId, branchId, businessDate, branch.timezone),
  ]);

  const names = await resolveNames(tenantId, [row?.openedById, row?.closedById]);
  const expectedClosingPaisa =
    row == null ? null : row.openingBalancePaisa + movement.cashSalesPaisa - movement.cashExpensesPaisa;

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
    note: row?.note ?? null,
  };
}

export async function openDrawerDay(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { openingBalancePaisa: number; businessDate?: string; note?: string | null }
): Promise<CashDrawerDayView> {
  const branch = await branchOrThrow(tenantId, branchId);
  const businessDate = input.businessDate ?? todayFor(branch.timezone);
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

export async function closeDrawerDay(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { closingCountedPaisa: number; businessDate?: string; note?: string | null }
): Promise<CashDrawerDayView> {
  const branch = await branchOrThrow(tenantId, branchId);
  const businessDate = input.businessDate ?? todayFor(branch.timezone);
  if (!isBusinessDay(businessDate)) throw new HttpError(400, "That isn't a valid date.");
  if (!Number.isInteger(input.closingCountedPaisa) || input.closingCountedPaisa < 0) {
    throw new HttpError(400, "The counted amount can't be negative.");
  }

  const existing = await tenantDb(tenantId).cashDrawerDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate } },
  });
  if (!existing) throw new HttpError(400, "This day's drawer was never opened, so there's nothing to close.");
  // A second count would overwrite the first and erase the variance that was actually investigated.
  if (existing.closedAt) throw new HttpError(409, "This day has already been closed.");

  await tenantDb(tenantId).cashDrawerDay.update({
    where: { id: existing.id },
    data: {
      closingCountedPaisa: input.closingCountedPaisa,
      closedById: actorId,
      closedAt: new Date(),
      note: input.note?.trim() || existing.note,
    },
  });

  return getDrawerDay(tenantId, branchId, businessDate);
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
