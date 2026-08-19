import { definePlatformHandler } from "@/server/platform-handler";
import { getTenantDetail } from "@/server/platform";

// GET /api/platform/tenants/[tenantId] — the drill-down view: branches, active staff, and the
// last 20 audit log entries for this tenant.
export const GET = definePlatformHandler({}, async ({ params }) => getTenantDetail(params.tenantId));
