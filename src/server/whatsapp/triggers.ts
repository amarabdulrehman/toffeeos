import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";
import { tenantDb, rawDb } from "@/server/db";
import { formatPkr } from "@/lib/money";
import { salesReport, itemWiseReport } from "@/server/reports";
import { inactiveCustomers } from "@/server/crm";
import { businessDayOf, businessDayRange } from "@/lib/business-day";
import { getBranchClock } from "@/server/branch-settings";
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
 * salesReport/itemWiseReport (Phase 3) rather than recomputing sales figures, and businessDayOf/
 * businessDayRange (src/lib/business-day.ts) rather than recomputing the boundary math — the Cash
 * Drawer and the report suite (src/server/reports.ts) resolve the same "what day is this instant"
 * question the same way, so this can't quietly drift from either. `forDate` overrides "yesterday"
 * for manual/testing invocation. */
export async function sendDailySummaryForBranch(tenantId: string, branchId: string, forDate?: Date) {
  const db = tenantDb(tenantId);
  const branch = await db.branch.findUniqueOrThrow({ where: { id: branchId } });

  const { dayStartMinutes } = await getBranchClock(tenantId, branchId);
  const targetInstant = forDate ?? subDays(new Date(), 1);
  const dayString = businessDayOf(targetInstant, branch.timezone, dayStartMinutes);
  const { from, to } = businessDayRange(dayString, branch.timezone, dayStartMinutes);

  const [sales, items] = await Promise.all([
    salesReport(tenantId, [branchId], { from, to, timezone: branch.timezone, dayStartMinutes }),
    itemWiseReport(tenantId, [branchId], { from, to, timezone: branch.timezone, dayStartMinutes }),
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

/** Called from both createOrder (stage "ON_ORDER") and takePayment (stage "ON_PAYMENT") — each
 * tenant picks which one actually fires via WhatsAppSettings.thankYouTrigger (defaults to
 * ON_PAYMENT), so this bails immediately unless `stage` matches their choice. Never DELIVERY —
 * that type already gets its own pickup/delivered messages via
 * notifyDeliveryPickedUp/notifyDeliveryDelivered, and a "hope you loved it" the moment a delivery
 * order is placed or paid — often well before the food is even made — reads oddly either way.
 * Only sends if the order has a customer attached with a phone number; a walk-in with no CRM
 * record just silently gets nothing, same as every other trigger here. */
export async function notifyOrderThankYou(
  tenantId: string,
  branchId: string,
  orderId: string,
  stage: "ON_ORDER" | "ON_PAYMENT"
) {
  const db = tenantDb(tenantId);
  const settings = await db.whatsAppSettings.findUnique({ where: { tenantId } });
  if ((settings?.thankYouTrigger ?? "ON_PAYMENT") !== stage) return null;

  const order = await db.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  if (!order?.customer?.phone || order.type === "DELIVERY") return null;

  const tenant = await rawDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  return notifyWhatsApp({
    tenantId,
    branchId,
    customerId: order.customer.id,
    toPhone: order.customer.phone,
    templateKey: "thank_you",
    params: [order.customer.name ?? "there", tenant.name],
  });
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
