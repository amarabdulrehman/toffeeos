import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { addRecipient, listRecipients } from "@/server/whatsapp/settings";

const querySchema = z.object({ branchId: z.string().min(1).optional() });

// GET /api/whatsapp/recipients[?branchId=] — defaults to the caller's own branch.
export const GET = defineHandler({ permission: "whatsapp.manage", input: querySchema }, async ({ session, input }) => {
  const recipients = await listRecipients(session.tenantId, input.branchId ?? session.branchId);
  return { recipients };
});

const bodySchema = z.object({
  branchId: z.string().min(1).optional(),
  label: z.string().min(1).max(80),
  phone: z.string().min(6).max(20),
});

export const POST = defineHandler({ permission: "whatsapp.manage", input: bodySchema }, async ({ session, input }) => {
  const recipient = await addRecipient(session.tenantId, input.branchId ?? session.branchId, input.label, input.phone);
  return { recipient };
});
