import { defineHandler } from "@/server/handler";
import { submitTemplateForApproval } from "@/server/whatsapp/templates";

export const POST = defineHandler({ permission: "whatsapp.manage" }, async ({ session, params }) => {
  const template = await submitTemplateForApproval(session.tenantId, params.templateId);
  return { template };
});
