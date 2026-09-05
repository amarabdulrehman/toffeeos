import "server-only";
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

async function issueResetToken(userType: "tenant" | "platform", userId: string, tenantId: string | null): Promise<string> {
  const { token } = await platformDb.passwordResetToken.create({
    data: { userType, userId, tenantId, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
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
  const record = await platformDb.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
  }

  const passwordHash = await hashPassword(newPassword);

  if (record.userType === "platform") {
    await platformDb.platformUser.update({ where: { id: record.userId }, data: { passwordHash } });
  } else {
    if (!record.tenantId) throw new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
    await tenantDb(record.tenantId).user.update({ where: { id: record.userId }, data: { passwordHash } });
  }

  await platformDb.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } });
}
