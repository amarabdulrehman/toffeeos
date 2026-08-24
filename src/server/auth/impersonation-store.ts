import "server-only";
import { platformDb } from "@/server/db";

/**
 * Persistent (Postgres-backed) single-use token store — was an in-memory Map. A platform admin's
 * "Impersonate" click and the browser's subsequent signIn("impersonate", {token}) call on the next
 * page load are two separate requests that can land on two different serverless instances; an
 * in-memory Map on the first instance would just never see the second request's lookup.
 * ImpersonationToken is platform-level (no RLS, not tenant data). Tokens are single-use and
 * short-lived on purpose: the only job here is to hand off from "platform admin clicked
 * Impersonate" to "NextAuth signIn call on the next page load" without putting a raw userId in a
 * URL.
 */
const TOKEN_TTL_MS = 60 * 1000;

export async function issueImpersonationToken(
  grant: Omit<{ tenantId: string; targetUserId: string; platformUserId: string; platformUserEmail: string; expiresAt: number }, "expiresAt">
): Promise<string> {
  const token = crypto.randomUUID();
  await platformDb.impersonationToken.create({
    data: { token, ...grant, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

export async function consumeImpersonationToken(
  token: string
): Promise<{ tenantId: string; targetUserId: string; platformUserId: string; platformUserEmail: string } | null> {
  const grant = await platformDb.impersonationToken.findUnique({ where: { token } });
  if (!grant) return null;
  await platformDb.impersonationToken.delete({ where: { token } }).catch(() => {});
  if (Date.now() > grant.expiresAt.getTime()) return null;
  const { tenantId, targetUserId, platformUserId, platformUserEmail } = grant;
  return { tenantId, targetUserId, platformUserId, platformUserEmail };
}
