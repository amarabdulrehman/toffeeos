import { defineHandler } from "@/server/handler";
import { getCustomerDetail } from "@/server/crm";

// GET /api/customers/[customerId] — order history + loyalty signal for one customer.
export const GET = defineHandler({ permission: "crm.view" }, async ({ session, params }) => {
  return getCustomerDetail(session.tenantId, params.customerId);
});
