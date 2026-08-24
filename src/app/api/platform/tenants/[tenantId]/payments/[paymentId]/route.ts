import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { voidTenantPayment } from "@/server/billing";

const voidSchema = z.object({ reason: z.string().min(3).max(300) });

// DELETE /api/platform/tenants/[tenantId]/payments/[paymentId] — soft-voids a mis-recorded
// payment (definePlatformHandler reads the JSON body for any non-GET method, so a DELETE with a
// body works here same as everywhere else in this app). Never hard-deletes — see voidTenantPayment.
export const DELETE = definePlatformHandler({ input: voidSchema }, async ({ session, params, input }) =>
  voidTenantPayment(params.tenantId, params.paymentId, input.reason, session.id, session.email)
);
