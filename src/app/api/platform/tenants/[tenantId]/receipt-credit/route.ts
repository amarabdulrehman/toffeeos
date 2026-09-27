import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { setTenantReceiptCredit } from "@/server/platform";

const schema = z.object({ on: z.boolean() });

// PATCH /api/platform/tenants/[tenantId]/receipt-credit — whether "ToffeeOS by Krimsols ·
// @krimsols" prints on this restaurant's receipts and bills. Platform admin only: a restaurant has
// no switch of its own.
export const PATCH = definePlatformHandler({ input: schema }, async ({ session, params, input }) => {
  return setTenantReceiptCredit(params.tenantId, input.on, session.id, session.email);
});
