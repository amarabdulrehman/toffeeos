import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { findOrCreateCustomer } from "@/server/crm";

const bodySchema = z.object({ phone: z.string().min(1), name: z.string().max(120).optional() });

// POST /api/customers/find-or-create — the POS phone-lookup-with-inline-creation flow. Gated by
// pos.order.create (not crm.manage): attaching or creating a customer while building an order is
// a POS action every order-taking role already has, not a back-office CRM edit.
export const POST = defineHandler(
  { permission: "pos.order.create", input: bodySchema },
  async ({ session, input }) => {
    const customer = await findOrCreateCustomer(session.tenantId, input.phone, input.name);
    return { customer };
  }
);
