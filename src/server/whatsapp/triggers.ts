import "server-only";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";
import { tenantDb } from "@/server/db";
import { formatPkr } from "@/lib/money";
import { salesReport, itemWiseReport } from "@/server/reports";
import { inactiveCustomers } from "@/server/crm";
import { notifyWhatsApp } from "./send";
import type { NewLowStockAlert } from "@/server/inventory";

async function recipientsFor(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  return db.whatsAppRecipient.findMany({ where: { branchId, isActive: true } });
}

function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}

/** Fired after a stock-mutating transaction commits (GRN, adjustment, transfer, recipe
 * consumption) when applyStockDelta reports a newly-opened LowStockAlert — never called from
 * inside that transaction, since a WhatsApp send is not something a stock write should roll back
 * for. One message per recipient, fire-and-forget (errors are logged in WhatsAppMessageLog, not
 * thrown). */
export async function notifyLowStock(tenantId: string, alert: NewLowStockAlert) {
  const recipients = await recipientsFor(tenantId, alert.branchId);
  await Promise.all(
    recipients.map((r) =>
      notifyWhatsApp({
        tenantId,
        branchId: alert.branchId,
        toPhone: r.phone,
        templateKey: "low_stock_alert",
        params: [
          alert.itemName,
          // Stock quantities are floating point (fractional kg/L), so raw arithmetic can surface
          // binary rounding noise (e.g. 0.299999999999997) straight into a customer-facing message.
          `${roundQty(alert.quantityAtTrigger)} ${alert.unitOfMeasure}`,
          `${roundQty(alert.thresholdAtTrigger)} ${alert.unitOfMeasure}`,
        ],
      })
    )
  );
}

/** "End of day, per branch, timezone-aware": computed in the branch's own IANA timezone (Branch.timezone), not
 * server-local or UTC — a branch in Asia/Karachi and one in a future different timezone both get a
 * summary for their own local yesterday, not whatever day it happens to be on the server. Reuses
 * salesReport/itemWiseReport (Phase 3) rather than recomputing sales figures. `forDate` overrides
 * "yesterday" for manual/testing invocation. */
export async function sendDailySummaryForBranch(tenantId: string, branchId: string, forDate?: Date) {
  const db = tenantDb(tenantId);
  const branch = await db.branch.findUniqueOrThrow({ where: { id: branchId } });

  // "Yesterday" (or forDate) as a wall-clock calendar day in the branch's own timezone, not the
  // server's — converted with fromZonedTime so the actual DB query boundaries are real UTC
  // instants, not the toZonedTime "fake local" Date that's only safe to use with formatInTimeZone.
  const targetInstant = forDate ?? subDays(new Date(), 1);
  const dayString = formatInTimeZone(targetInstant, branch.timezone, "yyyy-MM-dd");
  const from = fromZonedTime(`${dayString} 00:00:00.000`, branch.timezone);
  const to = fromZonedTime(`${dayString} 23:59:59.999`, branch.timezone);

  const [sales, items] = await Promise.all([
    salesReport(tenantId, [branchId], { from, to }),
    itemWiseReport(tenantId, [branchId], { from, to }),
  ]);
  const topItems = items.slice(0, 3);
  const dayLabel = formatInTimeZone(from, branch.timezone, "MMM d");

  const body = [
    `${dayLabel} at ${branch.name}: ${sales.orderCount} orders, ${formatPkr(sales.totalPaisa)}.`,
    topItems.length > 0 ? `Top items: ${topItems.map((i) => i.name).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const recipients = await recipientsFor(tenantId, branchId);
  await Promise.all(
    recipients.map((r) =>
      notifyWhatsApp({
        tenantId,
        branchId,
        toPhone: r.phone,
        templateKey: "daily_summary",
        params: [dayLabel, branch.name, String(sales.orderCount), formatPkr(sales.totalPaisa), topItems.map((i) => i.name).join(", ") || "—"],
      })
    )
  );

  return { branchId, branchName: branch.name, dayLabel, orderCount: sales.orderCount, totalPaisa: sales.totalPaisa, body, recipientCount: recipients.length };
}

export async function sendDailySummaryForAllBranches(tenantId: string, forDate?: Date) {
  const db = tenantDb(tenantId);
  const branches = await db.branch.findMany({ where: { isActive: true } });
  return Promise.all(branches.map((b) => sendDailySummaryForBranch(tenantId, b.id, forDate)));
}

/** Uses the Phase 3 CRM's "inactive 30+ days" segment. Manually triggered (a promotional send
 * deserves an explicit decision, not a silent cron), gated the same way as every other message
 * type by notifyWhatsApp — a customer's whatsappOptOut and the win_back_30d template's approval
 * status are both checked per-recipient, not assumed. */
export async function sendWinBackBatch(tenantId: string, inactiveDays = 30) {
  const customers = await inactiveCustomers(tenantId, inactiveDays);
  const results = await Promise.all(
    customers
      .filter((c) => c.phone)
      .map((c) =>
        notifyWhatsApp({
          tenantId,
          customerId: c.id,
          toPhone: c.phone!,
          templateKey: "win_back_30d",
          params: [c.name ?? "there"],
        })
      )
  );
  return {
    attempted: results.length,
    sent: results.filter((r) => r.status === "SENT").length,
    skipped: results.filter((r) => r.status !== "SENT").length,
  };
}

export async function notifyDeliveryPickedUp(tenantId: string, branchId: string, orderId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  if (!order?.customer?.phone) return null;
  return notifyWhatsApp({
    tenantId,
    branchId,
    customerId: order.customer.id,
    toPhone: order.customer.phone,
    templateKey: "delivery_picked_up",
    params: [order.customer.name ?? "there", String(order.orderNumber)],
  });
}

export async function notifyDeliveryDelivered(tenantId: string, branchId: string, orderId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  if (!order?.customer?.phone) return null;
  return notifyWhatsApp({
    tenantId,
    branchId,
    customerId: order.customer.id,
    toPhone: order.customer.phone,
    templateKey: "delivery_delivered",
    params: [order.customer.name ?? "there", String(order.orderNumber)],
  });
}
