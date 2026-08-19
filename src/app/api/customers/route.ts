import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listCustomers } from "@/server/crm";

const querySchema = z.object({ q: z.string().optional() });

// GET /api/customers — the CRM customer list, with a live-computed loyalty signal per customer
// (total orders, total spend, last order date). Optional ?q= filters by phone or name.
export const GET = defineHandler({ permission: "crm.view", input: querySchema }, async ({ session, input }) => {
  const customers = await listCustomers(session.tenantId, input.q);
  return { customers };
});
