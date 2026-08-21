import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { getTenantDetail, changeTenantTier } from "@/server/platform";
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
