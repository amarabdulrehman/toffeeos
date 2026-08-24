import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { setCustomMonthlyRate } from "@/server/billing";

const rateSchema = z.object({ customMonthlyPricePaisa: z.number().int().min(0).nullable() });

// PATCH /api/platform/tenants/[tenantId]/rate — sets (or clears, with null) a tenant's contracted
// monthly price independent of recording a payment, for a mid-period renegotiation.
export const PATCH = definePlatformHandler({ input: rateSchema }, async ({ session, params, input }) =>
  setCustomMonthlyRate(params.tenantId, input.customMonthlyPricePaisa, session.id, session.email)
);
