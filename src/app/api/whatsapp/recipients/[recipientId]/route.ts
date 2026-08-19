import { defineHandler } from "@/server/handler";
import { removeRecipient } from "@/server/whatsapp/settings";

export const DELETE = defineHandler({ permission: "whatsapp.manage" }, async ({ session, params }) => {
  await removeRecipient(session.tenantId, params.recipientId);
  return { ok: true };
});
