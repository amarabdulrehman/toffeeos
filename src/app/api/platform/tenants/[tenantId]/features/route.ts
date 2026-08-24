import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { setTenantFeatures } from "@/server/platform";

const featuresSchema = z.object({ enabledModules: z.array(z.string()) });

// PATCH /api/platform/tenants/[tenantId]/features — sets a tenant's per-feature toggles directly,
// independent of its tier. Separate from the tier-change PATCH at the parent route since this is a
// distinct, audit-worthy action with its own input shape (see setTenantFeatures for the "why
// separate from tier" reasoning).
export const PATCH = definePlatformHandler({ input: featuresSchema }, async ({ session, params, input }) => {
  const result = await setTenantFeatures(params.tenantId, input.enabledModules, session.id, session.email);
  return result;
});
