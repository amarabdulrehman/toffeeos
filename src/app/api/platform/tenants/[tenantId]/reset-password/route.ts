import { z } from "zod";
import { definePlatformHandler } from "@/server/platform-handler";
import { resetTenantUserPassword } from "@/server/platform";

const schema = z.object({ userId: z.string().min(1) });

// POST /api/platform/tenants/[tenantId]/reset-password — the answer to "a client rang, they're
// locked out". Returns a one-time temporary password to read back to them; the account is forced to
// change it on next sign-in and any session it already had is revoked. Platform-admin only, like
// every route under /api/platform.
export const POST = definePlatformHandler({ input: schema }, async ({ session, params, input }) =>
  resetTenantUserPassword(params.tenantId, input.userId, session.id, session.email)
);
