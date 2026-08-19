import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { inactiveCustomers } from "@/server/crm";

const querySchema = z.object({ days: z.coerce.number().int().positive().default(30) });

// GET /api/customers/inactive?days=30 — segmentation query for "hasn't ordered in N+ days."
// This is the query Phase 4's WhatsApp win-back send will reuse; nothing sends yet.
export const GET = defineHandler({ permission: "crm.view", input: querySchema }, async ({ session, input }) => {
  const customers = await inactiveCustomers(session.tenantId, input.days);
  return { customers };
});
