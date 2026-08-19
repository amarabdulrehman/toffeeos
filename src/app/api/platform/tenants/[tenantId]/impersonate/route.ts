import { definePlatformHandler } from "@/server/platform-handler";
import { startImpersonation } from "@/server/platform";

// POST /api/platform/tenants/[tenantId]/impersonate — issues a 60-second single-use token for
// the client to hand to signIn("impersonate", {token}). Audit-logged before the token is even
// issued, regardless of whether the platform admin follows through and signs in.
export const POST = definePlatformHandler({}, async ({ session, params }) => {
  const token = await startImpersonation(params.tenantId, session.id, session.email);
  return { token };
});
