import "server-only";

/**
 * DEV-ONLY in-memory single-use token store — same caveats as otp-store.ts (won't survive a
 * redeploy or work across multiple server instances; fine for local dev, replace with a DB- or
 * Redis-backed store before going live). Tokens are single-use and short-lived on purpose: the
 * only job here is to hand off from "platform admin clicked Impersonate" to "NextAuth signIn call
 * on the next page load" without putting a raw userId in a URL.
 */
interface ImpersonationGrant {
  tenantId: string;
  targetUserId: string;
  platformUserId: string;
  platformUserEmail: string;
  expiresAt: number;
}

const grants = new Map<string, ImpersonationGrant>();
const TOKEN_TTL_MS = 60 * 1000;

export function issueImpersonationToken(grant: Omit<ImpersonationGrant, "expiresAt">): string {
  const token = crypto.randomUUID();
  grants.set(token, { ...grant, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function consumeImpersonationToken(token: string): Omit<ImpersonationGrant, "expiresAt"> | null {
  const grant = grants.get(token);
  if (!grant) return null;
  grants.delete(token);
  if (Date.now() > grant.expiresAt) return null;
  const { tenantId, targetUserId, platformUserId, platformUserEmail } = grant;
  return { tenantId, targetUserId, platformUserId, platformUserEmail };
}
