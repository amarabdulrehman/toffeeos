import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { rejectTemplate } from "@/server/whatsapp/templates";

const bodySchema = z.object({ reason: z.string().min(1).max(500) });

export const POST = defineHandler({ permission: "whatsapp.manage", input: bodySchema }, async ({ session, params, input }) => {
  const template = await rejectTemplate(session.tenantId, params.templateId, input.reason);
  return { template };
});
