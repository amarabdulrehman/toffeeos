import { defineHandler } from "@/server/handler";
import { approveTemplate } from "@/server/whatsapp/templates";

// Stands in for "someone checked WhatsApp Business Manager and Meta approved it" — there's no
// webhook to simulate that here, so this is a manual action.
export const POST = defineHandler({ permission: "whatsapp.manage" }, async ({ session, params }) => {
  const template = await approveTemplate(session.tenantId, params.templateId);
  return { template };
});
