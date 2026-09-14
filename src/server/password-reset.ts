import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { platformDb, tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { hashPassword } from "@/lib/password";
import { sendEmail } from "@/server/email/adapter";
import { findTenantBySlug } from "@/server/auth/session-user";
import { env } from "@/lib/env";
import { BRAND_NAME } from "@/config/brand";

const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Self-serve password recovery for both user types — there was previously no path at all for
 * either a tenant staff member or the platform admin to recover a forgotten password. Both request
 * functions always resolve the same way regardless of whether the account exists, and the API
 * routes that call them always return the same generic message — this is what keeps the flow from
 * being usable to enumerate which emails have accounts.
 */

/**
 * The row stores a SHA-256 of the token, never the token itself.
 *
 * The column used to hold the live value (it was the `@default(uuid())` primary key), which made
 * every unexpired row in this table a ready-to-use credential for whoever could read it — and one
 * of them resets the *platform admin*, whose account is the super-admin console. That is not only
 * a database-breach concern: src/server/backup.ts dumps all 51 tables, this one included, so every
 * daily backup carried a set of working reset links.
 *
 * A fingerprint costs nothing here because the lookup is an exact match, never a range scan: we
 * hash what the caller presents and look for that. No migration is needed — the column is a plain
 * String, and what changes is only what we choose to put in it. Reset links issued before this
 * change stop resolving, which is correct and self-repairing: they expire in 30 minutes anyway,
 * and anyone holding a stale one simply asks for another.
 *
 * Unsalted SHA-256 is the right primitive rather than bcrypt/argon: this input is 32 bytes of
 * CSPRNG output, not a human-chosen password, so there is nothing to brute-force or rainbow-table
 * and the constant-time-hashing argument does not apply.
 */
function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function issueResetToken(userType: "tenant" | "platform", userId: string, tenantId: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await platformDb.passwordResetToken.create({
    data: { token: tokenFingerprint(token), userType, userId, tenantId, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

export async function requestTenantPasswordReset(tenantSlug: string, email: string): Promise<void> {
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return;

  const user = await tenantDb(tenant.id).user.findFirst({ where: { email }, select: { id: true, isActive: true } });
  if (!user || !user.isActive) return;

  const token = await issueResetToken("tenant", user.id, tenant.id);
  const link = `${env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;
  await sendEmail(
    email,
    `Reset your ${BRAND_NAME} password`,
    `Someone (hopefully you) asked to reset the password for this account.\n\nReset it here (expires in 30 minutes): ${link}\n\nIf you didn't request this, you can ignore this email.`
  );
}

export async function requestPlatformPasswordReset(email: string): Promise<void> {
  const user = await platformDb.platformUser.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;

  const token = await issueResetToken("platform", user.id, null);
  const link = `${env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;
  await sendEmail(
    email,
    `Reset your ${BRAND_NAME} platform admin password`,
    `Someone (hopefully you) asked to reset the password for this account.\n\nReset it here (expires in 30 minutes): ${link}\n\nIf you didn't request this, you can ignore this email.`
  );
}

/** Validates and consumes a reset token, then updates the right table's passwordHash based on
 * userType. Single-use — usedAt is set the moment this succeeds, so a leaked/logged link can't be
 * replayed even within its 30-minute window. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const fingerprint = tokenFingerprint(token);
  const reject = () => new HttpError(400, "This reset link is invalid or has expired. Request a new one.");

  /**
   * Claim the token first, in one conditional write, and treat "no row updated" as invalid.
   *
   * It used to read the row, check `usedAt`, change the password, and only then mark the token
   * used — three statements with no transaction around them. Two requests arriving together both
   * passed the check before either wrote, so a single link could set the password twice; and a
   * failure after the password write left `usedAt` null, leaving a link that had already worked
   * still usable. Making the claim the first thing that happens closes both: the database decides
   * the winner, and only the caller who actually moved `usedAt` proceeds.
   *
   * This fails closed. If the password update below throws, the token stays spent and the user has
   * to request another — the safe direction for a link that grants account access.
   */
  const claimed = await platformDb.passwordResetToken.updateMany({
    where: { token: fingerprint, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw reject();

  const record = await platformDb.passwordResetToken.findUnique({ where: { token: fingerprint } });
  if (!record) throw reject();

  const passwordHash = await hashPassword(newPassword);

  // Revoked in the same write as the new hash. A password reset is very often used *because*
  // someone else may have the account, and leaving their stateless JWT alive until it expires
  // would defeat the whole exercise — the attacker keeps access despite the password change.
  const revoked = { passwordHash, sessionsValidFrom: new Date() };

  if (record.userType === "platform") {
    await platformDb.platformUser.update({ where: { id: record.userId }, data: revoked });
  } else {
    if (!record.tenantId) throw reject();
    await tenantDb(record.tenantId).user.update({ where: { id: record.userId }, data: revoked });
  }
}
