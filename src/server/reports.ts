import "server-only";
import { differenceInMinutes } from "date-fns";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { currentUnitCostPaisa } from "@/server/recipes";
import type { TenantSessionUser } from "@/server/auth/types";

/**
 * A Branch Manager only ever sees their own branch's reports; a Restaurant Owner (or anyone else
 * with `orders.viewAllBranches`) sees every branch by default, or one specific branch if they ask
 * for it. This is the one function every report route calls first — it's what makes "Platform
 * Owner isn't in scope for tenant-level reports" true too, since platform sessions never reach
 * these routes at all (defineHandler requires kind === "tenant").
 */
export async function resolveReportBranchIds(
  session: TenantSessionUser,
  requestedBranchId?: string
): Promise<string[]> {
  if (!session.permissions.includes("orders.viewAllBranches")) {
    return [session.branchId];
  }
  if (requestedBranchId) return [requestedBranchId];
  const db = tenantDb(session.tenantId);
  const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true } });
  return branches.map((b) => b.id);
}

/**
 * The write-side counterpart to resolveReportBranchIds, and it lives next to it deliberately: the
 * two encode the same branch-isolation rule, and keeping them apart is how they drift.
 *
 * resolveReportBranchIds answers "which branches may this caller *see*" and returns a list to
 * filter by. This answers "which single branch may this caller *write to*", and throws rather than
 * quietly narrowing — silently redirecting a payroll disbursement to a different branch than the
 * one requested would be worse than refusing it.
 *
 * Without this, several HR routes took a branchId straight from the request body and trusted it:
 * a Branch Manager could record attendance, disburse payroll, or change a salary at a branch that
 * wasn't theirs. tenantDb() already made cross-*tenant* forgery impossible; this closes the
 * cross-*branch* case inside a tenant.
 */
export async function assertWritableBranchId(
  session: TenantSessionUser,
  requestedBranchId?: string
): Promise<string> {
  if (!requestedBranchId || requestedBranchId === session.branchId) return session.branchId;

  if (!session.permissions.includes("orders.viewAllBranches")) {
    throw new HttpError(403, "You can only make changes at your own branch.");
  }
  // Cross-branch is allowed for this caller, but the branch still has to be a real, active one in
  // their own tenant — tenantDb scopes the lookup, so another tenant's id simply isn't found.
  const branch = await tenantDb(session.tenantId).branch.findFirst({
    where: { id: requestedBranchId, isActive: true },
    select: { id: true },
  });
  if (!branch) throw new HttpError(404, "That branch doesn't exist.");
  return branch.id;
}

/** Same rule, for the routes that identify the target by membership rather than by branch. */
export async function assertWritableMembership(
  session: TenantSessionUser,
  membershipId: string
): Promise<{ membershipId: string; branchId: string }> {
  const membership = await tenantDb(session.tenantId).membership.findUnique({
    where: { id: membershipId },
    select: { id: true, branchId: true },
  });
  if (!membership) throw new HttpError(404, "That staff member doesn't exist.");
  const branchId = await assertWritableBranchId(session, membership.branchId);
  return { membershipId: membership.id, branchId };
}

export interface DateRange {
  from: Date;
  to: Date;
}

function previousEquivalentRange({ from, to }: DateRange): DateRange {
  const rangeMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - rangeMs), to: new Date(from.getTime()) };
}

/** What counts as realised revenue: a PAID order, dated by when the money actually came in
 * (`paidAt`, not `createdAt`). Shared by salesReport and pnlReport specifically so the P&L's
 * revenue line can never drift from the Sales tab's total — two screens quoting different revenue
 * for the same period is the fastest way to lose an owner's trust in both. */
function paidOrdersWhere(branchIds: string[], range: DateRange) {
  return {
    branchId: { in: branchIds },
    status: "PAID" as const,
    paidAt: { gte: range.from, lte: range.to },
  };
}

// ============================================================================
// Sales report — by day, by branch, by category, by payment method, with a
// comparison to the immediately-preceding equivalent period.
// ============================================================================

export async function salesReport(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const previous = previousEquivalentRange(range);

  const [orders, prevAgg, menuItems, categories] = await Promise.all([
    db.order.findMany({
      where: paidOrdersWhere(branchIds, range),
      include: { lines: true, payments: true, branch: { select: { id: true, name: true } } },
    }),
    db.order.aggregate({
      where: { branchId: { in: branchIds }, status: "PAID", paidAt: { gte: previous.from, lt: previous.to } },
      _sum: { totalPaisa: true },
      _count: { _all: true },
    }),
    db.menuItem.findMany({ select: { id: true, categoryId: true } }),
    db.category.findMany({ select: { id: true, name: true } }),
  ]);
  const categoryByMenuItem = new Map(menuItems.map((m) => [m.id, m.categoryId]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  let totalPaisa = 0;
  const byDay = new Map<string, { orders: number; totalPaisa: number }>();
  const byBranch = new Map<string, { branchName: string; orders: number; totalPaisa: number }>();
  const byCategory = new Map<string, { orders: number; revenuePaisa: number }>();
  const byPaymentMethod = new Map<string, number>();

  for (const o of orders) {
    totalPaisa += o.totalPaisa;

    const day = (o.paidAt ?? o.createdAt).toISOString().slice(0, 10);
    const dayEntry = byDay.get(day) ?? { orders: 0, totalPaisa: 0 };
    dayEntry.orders += 1;
    dayEntry.totalPaisa += o.totalPaisa;
    byDay.set(day, dayEntry);

    const branchEntry = byBranch.get(o.branchId) ?? { branchName: o.branch.name, orders: 0, totalPaisa: 0 };
    branchEntry.orders += 1;
    branchEntry.totalPaisa += o.totalPaisa;
    byBranch.set(o.branchId, branchEntry);

    for (const line of o.lines) {
      if (line.isVoided) continue;
      const catId = categoryByMenuItem.get(line.menuItemId);
      const name = catId ? (categoryName.get(catId) ?? "Uncategorized") : "Uncategorized";
      const catEntry = byCategory.get(name) ?? { orders: 0, revenuePaisa: 0 };
      catEntry.orders += 1;
      catEntry.revenuePaisa += line.lineTotalPaisa;
      byCategory.set(name, catEntry);
    }
    for (const p of o.payments) {
      byPaymentMethod.set(p.method, (byPaymentMethod.get(p.method) ?? 0) + p.amountPaisa);
    }
  }

  const prevTotalPaisa = prevAgg._sum.totalPaisa ?? 0;
  const changePct = prevTotalPaisa > 0 ? ((totalPaisa - prevTotalPaisa) / prevTotalPaisa) * 100 : null;

  return {
    orderCount: orders.length,
    totalPaisa,
    byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    byBranch: [...byBranch.entries()].map(([branchId, v]) => ({ branchId, ...v })),
    byCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.revenuePaisa - a.revenuePaisa),
    byPaymentMethod: [...byPaymentMethod.entries()].map(([method, amountPaisa]) => ({ method, amountPaisa })),
    previousPeriod: { orderCount: prevAgg._count._all, totalPaisa: prevTotalPaisa, changePct },
  };
}

/** Quantity sold and revenue per menu item across paid orders in the range, highest revenue
 * first — shared by the Item-wise report route and the WhatsApp daily summary's "top items" line
 * (src/server/whatsapp/triggers.ts), so the two never compute it differently. */
export async function itemWiseReport(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const orders = await db.order.findMany({
    where: { branchId: { in: branchIds }, status: "PAID", paidAt: { gte: range.from, lte: range.to } },
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

  return Array.from(byItem.entries())
    .map(([menuItemId, v]) => ({ menuItemId, ...v }))
    .sort((a, b) => b.revenuePaisa - a.revenuePaisa);
}

// ============================================================================
// Staff performance — orders handled, avg order value, discounts/voids, per
// staff member per day (a "shift" concept doesn't exist yet — see the note in
// the Phase 3 summary; this is the closest honest proxy without inventing one).
// ============================================================================

export async function staffPerformanceReport(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const [orders, discounts, voids, users] = await Promise.all([
    db.order.findMany({
      where: { branchId: { in: branchIds }, status: "PAID", paidAt: { gte: range.from, lte: range.to } },
      select: { createdById: true, totalPaisa: true, paidAt: true },
    }),
    db.orderDiscount.findMany({
      where: { tenantId, order: { branchId: { in: branchIds }, paidAt: { gte: range.from, lte: range.to } } },
      select: { appliedById: true, value: true, type: true, order: { select: { paidAt: true } } },
    }),
    db.orderEvent.findMany({
      where: {
        tenantId,
        type: "VOIDED",
        createdAt: { gte: range.from, lte: range.to },
        order: { branchId: { in: branchIds } },
      },
      select: { actorId: true, createdAt: true },
    }),
    db.user.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  interface Row {
    staffId: string;
    staffName: string;
    day: string;
    orders: number;
    totalPaisa: number;
    discounts: number;
    voids: number;
  }
  const byStaffDay = new Map<string, Row>();

  function ensure(staffId: string | null, day: string): Row {
    const id = staffId ?? "unknown";
    const key = `${id}:${day}`;
    let row = byStaffDay.get(key);
    if (!row) {
      row = { staffId: id, staffName: userName.get(id) ?? "Unknown", day, orders: 0, totalPaisa: 0, discounts: 0, voids: 0 };
      byStaffDay.set(key, row);
    }
    return row;
  }

  for (const o of orders) {
    const day = (o.paidAt ?? new Date()).toISOString().slice(0, 10);
    const row = ensure(o.createdById, day);
    row.orders += 1;
    row.totalPaisa += o.totalPaisa;
  }
  for (const d of discounts) {
    // OrderDiscount has no timestamp of its own — the order's paidAt is the closest proxy.
    if (!d.appliedById || !d.order.paidAt) continue;
    const day = d.order.paidAt.toISOString().slice(0, 10);
    ensure(d.appliedById, day).discounts += 1;
  }
  for (const v of voids) {
    if (!v.actorId) continue;
    const day = v.createdAt.toISOString().slice(0, 10);
    ensure(v.actorId, day).voids += 1;
  }

  return [...byStaffDay.values()]
    .map((r) => ({ ...r, avgOrderValuePaisa: r.orders > 0 ? Math.round(r.totalPaisa / r.orders) : 0 }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.totalPaisa - a.totalPaisa);
}

// ============================================================================
// Discount & void audit report
// ============================================================================

export async function discountVoidReport(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const [discounts, voidEvents, users] = await Promise.all([
    db.orderDiscount.findMany({
      where: { tenantId, order: { branchId: { in: branchIds } } },
      include: { order: { select: { orderNumber: true, branchId: true, createdAt: true } } },
      orderBy: { order: { createdAt: "desc" } },
    }),
    db.orderEvent.findMany({
      where: {
        tenantId,
        type: "VOIDED",
        createdAt: { gte: range.from, lte: range.to },
        order: { branchId: { in: branchIds } },
      },
      include: { order: { select: { orderNumber: true, branchId: true, totalPaisa: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.user.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const discountRows = discounts
    .filter((d) => d.order.createdAt >= range.from && d.order.createdAt <= range.to)
    .map((d) => ({
      kind: "discount" as const,
      orderNumber: d.order.orderNumber,
      actorName: d.appliedById ? (userName.get(d.appliedById) ?? "Unknown") : "Unknown",
      detail: d.type === "PERCENT" ? `${(d.value / 100).toFixed(0)}%` : `Rs ${(d.value / 100).toFixed(0)} flat`,
      reason: d.reason,
      createdAt: d.order.createdAt,
    }));

  const voidRows = voidEvents.map((e) => ({
    kind: "void" as const,
    orderNumber: e.order.orderNumber,
    actorName: e.actorId ? (userName.get(e.actorId) ?? "Unknown") : "Unknown",
    detail: `Rs ${(e.order.totalPaisa / 100).toFixed(0)} order voided`,
    reason: (e.payload as { reason?: string } | null)?.reason ?? null,
    createdAt: e.createdAt,
  }));

  return [...discountRows, ...voidRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ============================================================================
// Inventory valuation — current quantity × current (last-in) unit cost, per
// location. Reuses the same "last GRN cost" basis as the Recipe Cost report.
// ============================================================================

export async function inventoryValuationReport(tenantId: string, branchIds: string[]) {
  const db = tenantDb(tenantId);
  const locations = await db.stockLocation.findMany({ where: { branchId: { in: branchIds }, isActive: true } });
  const levels = await db.stockLevel.findMany({
    where: { locationId: { in: locations.map((l) => l.id) }, quantity: { gt: 0 } },
    include: { item: true, location: true },
  });

  const rows = await Promise.all(
    levels.map(async (level) => {
      const unitCost = await currentUnitCostPaisa(tenantId, level.itemId);
      const valuePaisa = unitCost !== null ? Math.round(unitCost * level.quantity) : null;
      return {
        locationName: level.location.name,
        itemName: level.item.name,
        unitOfMeasure: level.item.unitOfMeasure,
        quantity: level.quantity,
        unitCostPaisa: unitCost !== null ? Math.round(unitCost) : null,
        valuePaisa,
      };
    })
  );

  return {
    rows: rows.sort((a, b) => (b.valuePaisa ?? 0) - (a.valuePaisa ?? 0)),
    totalValuePaisa: rows.reduce((a, r) => a + (r.valuePaisa ?? 0), 0),
  };
}

// ============================================================================
// Rider performance — deliveries completed and average delivery time
// (assignment to delivered, per the Phase 3 brief), per rider.
// ============================================================================

export async function riderPerformanceReport(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const orders = await db.order.findMany({
    where: {
      branchId: { in: branchIds },
      type: "DELIVERY",
      deliveredAt: { gte: range.from, lte: range.to, not: null },
      assignedRiderId: { not: null },
    },
    select: { assignedRiderId: true, riderAssignedAt: true, deliveredAt: true },
  });
  const riderIds = [...new Set(orders.map((o) => o.assignedRiderId!))];
  const riders = await db.user.findMany({ where: { id: { in: riderIds } }, select: { id: true, name: true } });
  const riderName = new Map(riders.map((r) => [r.id, r.name]));

  const byRider = new Map<string, { deliveries: number; totalMinutes: number }>();
  for (const o of orders) {
    if (!o.assignedRiderId || !o.riderAssignedAt || !o.deliveredAt) continue;
    const entry = byRider.get(o.assignedRiderId) ?? { deliveries: 0, totalMinutes: 0 };
    entry.deliveries += 1;
    entry.totalMinutes += differenceInMinutes(o.deliveredAt, o.riderAssignedAt);
    byRider.set(o.assignedRiderId, entry);
  }

  return [...byRider.entries()]
    .map(([riderId, v]) => ({
      riderId,
      riderName: riderName.get(riderId) ?? "Unknown",
      deliveries: v.deliveries,
      avgDeliveryMinutes: v.deliveries > 0 ? Math.round(v.totalMinutes / v.deliveries) : 0,
    }))
    .sort((a, b) => b.deliveries - a.deliveries);
}

// ============================================================================
// Profit & Loss — cash-basis: money that actually came in vs money that actually
// went out in the range. Deliberately NOT accrual/COGS accounting; see the notes
// on pnlReport below for exactly what that does and doesn't mean.
// ============================================================================

export interface PnlReport {
  grossSalesPaisa: number;
  salesTaxPaisa: number;
  netRevenuePaisa: number;
  orderCount: number;
  stockPurchasesPaisa: number;
  /** GRNs in range whose cost was left blank. The cost field is optional at entry, so this is the
   * count of purchases silently missing from stockPurchasesPaisa — surfaced so an understated
   * cost line is visible rather than quietly wrong. */
  stockPurchasesMissingCost: number;
  salariesPaisa: number;
  expensesPaisa: number;
  expensesByCategory: { category: string; amountPaisa: number }[];
  totalCostsPaisa: number;
  netProfitPaisa: number;
  /** Net profit as a percentage of net revenue. Null when there's no revenue to divide by. */
  marginPct: number | null;
}

/**
 * Cash-basis P&L. Three things worth being explicit about, because each one is a place a reader
 * could reasonably expect a different number:
 *
 * 1. **Revenue is net of sales tax.** Order.totalPaisa includes taxPaisa, but PRA tax is collected
 *    on the government's behalf and remitted — it was never the restaurant's money. Counting it as
 *    revenue would overstate profit by the entire tax take. Gross and tax are both returned so the
 *    gross figure still reconciles exactly against the Sales tab.
 * 2. **Costs are purchases, not consumption.** Stock cost is what was *bought* in the range (GRN),
 *    not what was *used* — real COGS would need a recipe on every menu item, and most don't have
 *    one, so a "true" COGS line here would be confidently wrong rather than honestly approximate.
 *    A month with a big restock looks worse than it was; over a quarter it evens out.
 * 3. **Salaries come from PayrollDisbursement.paidAt, never runPayroll.** runPayroll returns a
 *    whole month's computed salary for *any* range you hand it, so using it would make a one-day
 *    P&L show a full month of wages. Only money actually disbursed inside the range counts.
 *
 * Expenses are APPROVED-only — the same rule the Expenses screen's totals use, so the two agree.
 */
export async function pnlReport(tenantId: string, branchIds: string[], range: DateRange): Promise<PnlReport> {
  const db = tenantDb(tenantId);

  const [orderAgg, grnAgg, grnMissingCost, payrollAgg, expenses, categories] = await Promise.all([
    db.order.aggregate({
      where: paidOrdersWhere(branchIds, range),
      _sum: { totalPaisa: true, taxPaisa: true },
      _count: { _all: true },
    }),
    db.stockMovement.aggregate({
      where: { branchId: { in: branchIds }, type: "GRN", createdAt: { gte: range.from, lte: range.to } },
      _sum: { costPaisa: true },
    }),
    db.stockMovement.count({
      where: {
        branchId: { in: branchIds },
        type: "GRN",
        createdAt: { gte: range.from, lte: range.to },
        costPaisa: null,
      },
    }),
    db.payrollDisbursement.aggregate({
      where: { branchId: { in: branchIds }, paidAt: { gte: range.from, lte: range.to } },
      _sum: { grossPayPaisa: true },
    }),
    db.expense.findMany({
      where: {
        branchId: { in: branchIds },
        status: "APPROVED",
        spentAt: { gte: range.from, lte: range.to },
      },
      select: { categoryId: true, amountPaisa: true },
    }),
    db.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);

  const grossSalesPaisa = orderAgg._sum.totalPaisa ?? 0;
  const salesTaxPaisa = orderAgg._sum.taxPaisa ?? 0;
  const netRevenuePaisa = grossSalesPaisa - salesTaxPaisa;

  const stockPurchasesPaisa = grnAgg._sum.costPaisa ?? 0;
  const salariesPaisa = payrollAgg._sum.grossPayPaisa ?? 0;

  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = new Map<string, number>();
  let expensesPaisa = 0;
  for (const e of expenses) {
    expensesPaisa += e.amountPaisa;
    const name = nameById.get(e.categoryId) ?? "Uncategorised";
    byCategory.set(name, (byCategory.get(name) ?? 0) + e.amountPaisa);
  }

  const totalCostsPaisa = stockPurchasesPaisa + salariesPaisa + expensesPaisa;
  const netProfitPaisa = netRevenuePaisa - totalCostsPaisa;

  return {
    grossSalesPaisa,
    salesTaxPaisa,
    netRevenuePaisa,
    orderCount: orderAgg._count._all,
    stockPurchasesPaisa,
    stockPurchasesMissingCost: grnMissingCost,
    salariesPaisa,
    expensesPaisa,
    expensesByCategory: [...byCategory.entries()]
      .map(([category, amountPaisa]) => ({ category, amountPaisa }))
      .sort((a, b) => b.amountPaisa - a.amountPaisa),
    totalCostsPaisa,
    netProfitPaisa,
    marginPct: netRevenuePaisa > 0 ? (netProfitPaisa / netRevenuePaisa) * 100 : null,
  };
}
