import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { adjustPoints, pointsHistory } from "@/server/loyalty";

// GET /api/customers/[customerId]/points — every point earned, spent and adjusted, and why.
export const GET = defineHandler({ permission: "crm.view" }, async ({ session, params }) => {
  return { history: await pointsHistory(session.tenantId, params.customerId) };
});

const schema = z.object({
  points: z.number().int().refine((n) => n !== 0, "Adjust by at least one point."),
  reason: z.string().min(1).max(200),
});

// POST /api/customers/[customerId]/points — a manual correction, up or down, with a reason.
export const POST = defineHandler(
  {
    permission: "crm.loyalty.adjust",
    input: schema,
    audit: (input) => ({ action: "loyalty.adjust", entityType: "Customer", metadata: { ...input } }),
  },
  async ({ session, params, input }) => {
    const customer = await adjustPoints(session.tenantId, session.id, { customerId: params.customerId, ...input });
    return { loyaltyPoints: customer.loyaltyPoints };
  }
);
