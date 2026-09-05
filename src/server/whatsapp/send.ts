import "server-only";
import { tenantDb } from "@/server/db";
import { sendWhatsAppCloudMessage } from "./adapter";
import { getApprovedTemplate, renderTemplate, type TemplateKey } from "./templates";
import { getTenantModules } from "@/server/tier";

type MessageCategory = "lowStockAlertsEnabled" | "dailySummaryEnabled" | "winBackEnabled" | "deliveryUpdatesEnabled" | "thankYouEnabled";

const CATEGORY_BY_KEY: Record<TemplateKey, MessageCategory> = {
  low_stock_alert: "lowStockAlertsEnabled",
  daily_summary: "dailySummaryEnabled",
  win_back_30d: "winBackEnabled",
  delivery_picked_up: "deliveryUpdatesEnabled",
  delivery_delivered: "deliveryUpdatesEnabled",
  thank_you: "thankYouEnabled",
};

export interface NotifyInput {
  tenantId: string;
  branchId?: string;
  customerId?: string;
  toPhone: string;
  templateKey: TemplateKey;
  params: string[];
}

/**
 * The single choke point every WhatsApp send goes through — every one of the four trigger points
 * (low-stock, daily summary, win-back, delivery updates) calls this rather than the adapter
 * directly, so "is this message type enabled," "did this customer opt out," and "is there an
 * approved template" are enforced exactly once. Never throws: a WhatsApp failure should never take
 * down the business operation (a payment, a delivery confirmation) that triggered it — every path
 * resolves to a logged WhatsAppMessageLog row instead.
 */
export async function notifyWhatsApp(input: NotifyInput) {
  const db = tenantDb(input.tenantId);

  const log = (status: "SENT" | "FAILED" | "SKIPPED_DISABLED" | "SKIPPED_OPTOUT" | "SKIPPED_NO_TEMPLATE", renderedBody?: string) =>
    db.whatsAppMessageLog.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        customerId: input.customerId,
        toPhone: input.toPhone,
        templateKey: input.templateKey,
        renderedBody,
        status,
      },
    });

  // WhatsApp is a gateable module — checked here (not just on the settings API/UI) so a tenant
  // whose WhatsApp toggle is off (downgraded, or explicitly disabled by a platform admin) has its
  // *automated* triggers stop firing too, not only the settings page. Reuses SKIPPED_DISABLED
  // rather than adding a new enum value: from the tenant's perspective it reads the same either way
  // ("this didn't send"), and the audit-worthy distinction (tier vs. toggle) is a platform-level
  // concern, not a tenant-facing one.
  const enabledModules = await getTenantModules(db);
  if (!enabledModules.includes("whatsapp")) return log("SKIPPED_DISABLED");

  const settings = await db.whatsAppSettings.findUnique({ where: { tenantId: input.tenantId } });
  if (!settings?.enabled || !settings[CATEGORY_BY_KEY[input.templateKey]]) {
    return log("SKIPPED_DISABLED");
  }

  if (input.customerId) {
    const customer = await db.customer.findUnique({ where: { id: input.customerId }, select: { whatsappOptOut: true } });
    if (customer?.whatsappOptOut) return log("SKIPPED_OPTOUT");
  }

  const template = await getApprovedTemplate(input.tenantId, input.templateKey);
  if (!template) return log("SKIPPED_NO_TEMPLATE");

  const body = renderTemplate(template.bodyText, input.params);
  const result = await sendWhatsAppCloudMessage(input.toPhone, body);
  return log(result.ok ? "SENT" : "FAILED", body);
}

export async function listMessageLog(tenantId: string, branchIds?: string[]) {
  const db = tenantDb(tenantId);
  return db.whatsAppMessageLog.findMany({
    where: branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
