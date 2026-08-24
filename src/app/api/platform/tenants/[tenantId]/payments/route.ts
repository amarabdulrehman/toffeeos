import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { recordTenantPayment, listTenantPayments } from "@/server/billing";
import { PAYMENT_METHODS } from "@/lib/billing";

const METHOD_KEYS = PAYMENT_METHODS.map((m) => m.value) as [string, ...string[]];

// GET /api/platform/tenants/[tenantId]/payments — the tenant's full payment history, for the
// Billing card on the tenant detail page.
export const GET = definePlatformHandler({}, async ({ params }) => ({
  payments: await listTenantPayments(params.tenantId),
}));

const recordPaymentSchema = z
  .object({
    amountPaisa: z.number().int().min(0).max(100_000_000_00),
    // z.coerce.date() because definePlatformHandler JSON-parses the body — dates arrive as ISO
    // strings, not Date instances.
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    method: z.enum(METHOD_KEYS),
    note: z.string().max(500).optional(),
    setAsRecurringRate: z.boolean().default(false),
    recurringRatePaisa: z.number().int().min(0).optional(),
  })
  .refine((v) => v.periodEnd > v.periodStart, {
    message: "Period end must be after period start",
    path: ["periodEnd"],
  });

// POST /api/platform/tenants/[tenantId]/payments — the admin's one primary billing action: record
// what was actually collected out-of-band, for whatever period was agreed. Always advances (never
// regresses) currentPeriodEnd, and always reactivates a suspended/cancelled tenant — see
// recordTenantPayment for the full contract.
export const POST = definePlatformHandler({ input: recordPaymentSchema }, async ({ session, params, input }) =>
  recordTenantPayment({ tenantId: params.tenantId, ...input }, session.id, session.email)
);
