import { definePlatformHandler } from "@/server/platform-handler";
import { platformMetrics } from "@/server/platform";

// GET /api/platform/metrics — tenant counts by status, total active branches, and MRR priced off
// each ACTIVE tenant's actual plan (not a flat guess).
export const GET = definePlatformHandler({}, async () => platformMetrics());
