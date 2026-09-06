import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { getTenantDetail, changeTenantTier, deleteTenant } from "@/server/platform";
import { TIER_ORDER } from "@/server/tier";

// GET /api/platform/tenants/[tenantId] — the drill-down view: branches, active staff, and the
// last 20 audit log entries for this tenant.
export const GET = definePlatformHandler({}, async ({ params }) => getTenantDetail(params.tenantId));

const tierSchema = z.object({ planKey: z.enum(TIER_ORDER) });

// PATCH /api/platform/tenants/[tenantId] — change a tenant's plan/tier. Separate from the
// list-level PATCH (which only handles lifecycle status) since this is a distinct, audit-worthy
// action with its own input shape.
export const PATCH = definePlatformHandler({ input: tierSchema }, async ({ session, params, input }) => {
  const result = await changeTenantTier(params.tenantId, input.planKey, session.id, session.email);
  return result;
});

// Typing the slug is the confirmation, and it is checked server-side rather than only in the
// dialog — the UI guard protects against a slip, this protects against a stale tab, a replayed
// request, or anything else that reaches the endpoint without a human reading the warning.
const deleteSchema = z.object({ confirmSlug: z.string().min(1) });

// DELETE /api/platform/tenants/[tenantId] — permanently erase a restaurant and all of its data.
// There is no undo. Suspending or cancelling via the list-level PATCH is the reversible option and
// is what should be reached for in almost every case; this exists for genuine removal (a client who
// has left and asked for their data to be deleted, or clearing out test tenants).
export const DELETE = definePlatformHandler({ input: deleteSchema }, async ({ session, params, input }) => {
  const result = await deleteTenant(params.tenantId, input.confirmSlug, {
    id: session.id,
    email: session.email,
  });
  return result;
});
