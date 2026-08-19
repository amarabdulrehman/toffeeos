import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";

export async function getSettings(tenantId: string) {
  const db = tenantDb(tenantId);
  const existing = await db.whatsAppSettings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  // Created lazily on first read, not at tenant signup — WhatsApp is opt-in, so most tenants never
  // need a row here at all until they actually visit the settings screen.
  return db.whatsAppSettings.create({ data: { tenantId } });
}

export interface UpdateSettingsInput {
  enabled?: boolean;
  lowStockAlertsEnabled?: boolean;
  dailySummaryEnabled?: boolean;
  winBackEnabled?: boolean;
  deliveryUpdatesEnabled?: boolean;
  businessPhoneNumberId?: string | null;
  businessAccountId?: string | null;
}

export async function updateSettings(tenantId: string, input: UpdateSettingsInput) {
  await getSettings(tenantId); // ensure a row exists
  const db = tenantDb(tenantId);
  return db.whatsAppSettings.update({ where: { tenantId }, data: input });
}

export async function listRecipients(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  return db.whatsAppRecipient.findMany({ where: { branchId }, orderBy: { createdAt: "asc" } });
}

export async function addRecipient(tenantId: string, branchId: string, label: string, phone: string) {
  const db = tenantDb(tenantId);
  return db.whatsAppRecipient.create({ data: { tenantId, branchId, label, phone } });
}

export async function removeRecipient(tenantId: string, recipientId: string) {
  const db = tenantDb(tenantId);
  const recipient = await db.whatsAppRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient) throw new HttpError(404, "Recipient not found.");
  await db.whatsAppRecipient.delete({ where: { id: recipientId } });
}
