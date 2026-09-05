import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";

export const TEMPLATE_KEYS = [
  "low_stock_alert",
  "daily_summary",
  "win_back_30d",
  "delivery_picked_up",
  "delivery_delivered",
  "thank_you",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export async function listTemplates(tenantId: string) {
  const db = tenantDb(tenantId);
  return db.whatsAppTemplate.findMany({ orderBy: { key: "asc" } });
}

export async function upsertDraftTemplate(tenantId: string, key: TemplateKey, name: string, bodyText: string) {
  const db = tenantDb(tenantId);
  const existing = await db.whatsAppTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } });
  if (existing && existing.status === "APPROVED") {
    throw new HttpError(409, "This template is already approved — editing it would require re-submission under WhatsApp's real approval process.");
  }
  return db.whatsAppTemplate.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, name, bodyText, status: "DRAFT" },
    update: { name, bodyText, status: "DRAFT", submittedAt: null, approvedAt: null, rejectionReason: null },
  });
}

/** Moves DRAFT/REJECTED -> PENDING_APPROVAL. In production this is the point a template gets
 * submitted to Meta's Business Manager for review; there's no webhook to simulate that here, so
 * approval is a manual action (approveTemplate/rejectTemplate) standing in for someone actually
 * checking Meta's dashboard. */
export async function submitTemplateForApproval(tenantId: string, templateId: string) {
  const db = tenantDb(tenantId);
  const template = await db.whatsAppTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (template.status === "APPROVED") throw new HttpError(409, "Already approved.");
  if (template.status === "PENDING_APPROVAL") throw new HttpError(409, "Already pending approval.");
  return db.whatsAppTemplate.update({
    where: { id: templateId },
    data: { status: "PENDING_APPROVAL", submittedAt: new Date(), rejectionReason: null },
  });
}

export async function approveTemplate(tenantId: string, templateId: string) {
  const db = tenantDb(tenantId);
  const template = await db.whatsAppTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (template.status !== "PENDING_APPROVAL") throw new HttpError(409, "Only a pending template can be approved.");
  return db.whatsAppTemplate.update({ where: { id: templateId }, data: { status: "APPROVED", approvedAt: new Date() } });
}

export async function rejectTemplate(tenantId: string, templateId: string, reason: string) {
  const db = tenantDb(tenantId);
  const template = await db.whatsAppTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (template.status !== "PENDING_APPROVAL") throw new HttpError(409, "Only a pending template can be rejected.");
  return db.whatsAppTemplate.update({ where: { id: templateId }, data: { status: "REJECTED", rejectionReason: reason } });
}

export async function getApprovedTemplate(tenantId: string, key: string) {
  const db = tenantDb(tenantId);
  const template = await db.whatsAppTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } });
  return template && template.status === "APPROVED" ? template : null;
}

/** Meta template syntax: {{1}}, {{2}}, ... — positional, 1-indexed. */
export function renderTemplate(bodyText: string, params: string[]): string {
  return params.reduce((text, param, i) => text.replaceAll(`{{${i + 1}}}`, param), bodyText);
}
