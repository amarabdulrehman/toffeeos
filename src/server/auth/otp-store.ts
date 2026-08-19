import "server-only";

/**
 * DEV-ONLY stub OTP store — in-memory, per-process. Fine for local development and demos; wrong
 * for production (won't survive a redeploy, doesn't work across multiple server instances, has no
 * rate limiting). Before going live, replace with a DB- or Redis-backed store and swap the
 * console.log below for a real WhatsApp Business API / SMS send (see the WhatsApp-native
 * differentiator in the product brief).
 */
const codes = new Map<string, { code: string; expiresAt: number }>();
const OTP_TTL_MS = 5 * 60 * 1000;

export function issueOtp(key: string): string {
  const code = Math.floor(100_000 + Math.random() * 900_000).toString();
  codes.set(key, { code, expiresAt: Date.now() + OTP_TTL_MS });
  console.log(`[OTP STUB] ${key} -> ${code} (expires in 5 min)`);
  return code;
}

export function verifyOtp(key: string, code: string): boolean {
  const entry = codes.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    codes.delete(key);
    return false;
  }
  const ok = entry.code === code;
  if (ok) codes.delete(key);
  return ok;
}
