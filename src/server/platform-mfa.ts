import "server-only";
import * as OTPAuth from "otpauth";
import { platformDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { generateTempPassword, hashPassword, verifyPassword } from "@/lib/password";
import { BRAND_NAME } from "@/config/brand";

const BACKUP_CODE_COUNT = 8;

function totpFor(email: string, secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: BRAND_NAME,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/**
 * Step 1 of enrollment — generates a fresh secret and its otpauth:// provisioning URI, but does
 * NOT persist anything yet. The secret only gets saved once verifyAndEnableTotp confirms the
 * admin actually scanned it and can produce a valid code; otherwise a half-finished enrollment
 * (secret saved, never confirmed) could silently lock the account if totpEnabled were set early.
 */
export function startTotpEnrollment(email: string): { secret: string; otpauthUrl: string } {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const otpauthUrl = totpFor(email, secret).toString();
  return { secret, otpauthUrl };
}

/** Step 2 — verifies the admin's first real code against the not-yet-saved secret, and only then
 * turns 2FA on. Returns the plaintext backup codes exactly once; only their bcrypt hashes are
 * stored, same as passwords. */
export async function verifyAndEnableTotp(
  platformUserId: string,
  email: string,
  secret: string,
  code: string
): Promise<{ backupCodes: string[] }> {
  const valid = totpFor(email, secret).validate({ token: code, window: 1 }) !== null;
  if (!valid) throw new HttpError(400, "That code didn't match. Check the time on your device and try again.");

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateTempPassword(10));
  const hashed = await Promise.all(backupCodes.map((c) => hashPassword(c)));

  await platformDb.platformUser.update({
    where: { id: platformUserId },
    data: { totpSecret: secret, totpEnabled: true, totpBackupCodes: hashed },
  });

  return { backupCodes };
}

export async function disableTotp(platformUserId: string): Promise<void> {
  await platformDb.platformUser.update({
    where: { id: platformUserId },
    data: { totpSecret: null, totpEnabled: false, totpBackupCodes: [] },
  });
}

/** Checked from the credentials authorize() step, after the password already matched. Tries a
 * live TOTP code first, then falls back to consuming a one-time backup code — a matched backup
 * code is removed from the array immediately so it can't be replayed. */
export async function verifyTotpOrBackupCode(
  platformUser: { id: string; email: string; totpSecret: string | null; totpBackupCodes: string[] },
  code: string
): Promise<boolean> {
  if (!platformUser.totpSecret) return false;

  const totpValid = totpFor(platformUser.email, platformUser.totpSecret).validate({ token: code, window: 1 }) !== null;
  if (totpValid) return true;

  for (const hashed of platformUser.totpBackupCodes) {
    if (await verifyPassword(code, hashed)) {
      await platformDb.platformUser.update({
        where: { id: platformUser.id },
        data: { totpBackupCodes: platformUser.totpBackupCodes.filter((h) => h !== hashed) },
      });
      return true;
    }
  }
  return false;
}
