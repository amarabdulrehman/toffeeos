import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getCustomerDetail } from "@/server/crm";

// GET /api/customers/[customerId] — order history + loyalty signal for one customer.
export const GET = defineHandler({ permission: "crm.view" }, async ({ session, params }) => {
  return getCustomerDetail(session.tenantId, params.customerId);
});

const patchSchema = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email().max(160).nullable().optional(),
  whatsappOptOut: z.boolean().optional(),
});

// PATCH /api/customers/[customerId] — the one customer-editing endpoint that existed as a gap
// since Phase 3 (Module 3 only ever built find-or-create + read). Built now because the WhatsApp
// opt-out toggle needs somewhere to write to; kept intentionally narrow (name/email/opt-out) —
// phone is the customer's stable identifier and isn't editable here.
export const PATCH = defineHandler({ permission: "crm.manage", input: patchSchema }, async ({ params, db, input }) => {
  const customer = await db.customer.update({ where: { id: params.customerId }, data: input });
  return { customer };
});
