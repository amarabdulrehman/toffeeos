import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listTemplates, upsertDraftTemplate, TEMPLATE_KEYS } from "@/server/whatsapp/templates";

export const GET = defineHandler({ permission: "whatsapp.manage" }, async ({ session }) => {
  const templates = await listTemplates(session.tenantId);
  return { templates };
});

const bodySchema = z.object({
  key: z.enum(TEMPLATE_KEYS),
  name: z.string().min(1).max(120),
  bodyText: z.string().min(1).max(1024),
});

// POST creates or replaces the DRAFT for a template key — editing an APPROVED template starts a
// fresh draft rather than mutating it in place (see upsertDraftTemplate's guard).
export const POST = defineHandler({ permission: "whatsapp.manage", input: bodySchema }, async ({ session, input }) => {
  const template = await upsertDraftTemplate(session.tenantId, input.key, input.name, input.bodyText);
  return { template };
});
