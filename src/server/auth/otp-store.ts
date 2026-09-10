import "server-only";
import { platformDb } from "@/server/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";

/**
 * Persistent (Postgres-backed) OTP store — was an in-memory Map, which is exactly wrong for a
 * login flow: "request OTP" and "verify OTP" are two separate requests that can land on two
 * different serverless instances, and a Map on instance A is invisible to instance B. OtpCode is
 * platform-level (no RLS, not tenant data) — an OTP is issued before any tenant session exists —
 * so this reads/writes via platformDb.
 *
 * Still needs a real WhatsApp Business API / SMS send behind the console.log below before going
 * live (see the WhatsApp-native differentiator in the product brief) — that part hasn't changed.
 */
const OTP_TTL_MS = 5 * 60 * 1000;

/**
 * Whether an issued code can actually reach the person it belongs to.
 *
 * There is no SMS/WhatsApp sender wired up, so the only "delivery" is the console.log below —
 * which is a development affordance and must never be a production one: it writes a live login
 * credential and a phone number into the log stream in plaintext, readable by anyone with access
 * to Vercel's logs or any drain attached to them, well within the code's 5-minute validity.
 *
 * So production has no delivery channel at all, and says so (see /api/auth/request-otp) instead of
 * minting codes nobody can receive. Riders sign in with email + password at /login meanwhile —
 * the same credentials flow every other role uses. When a real sender is added, this becomes a
 * check on that sender's config and phone login starts working with no other change.
 */
export function otpDeliveryAvailable(): boolean {
  return env.NODE_ENV !== "production";
}

export async function issueOtp(key: string): Promise<string> {
  const code = Math.floor(100_000 + Math.random() * 900_000).toString();
  await platformDb.otpCode.create({ data: { key, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  if (otpDeliveryAvailable()) {
    console.log(`[OTP STUB] ${key} -> ${code} (expires in 5 min)`);
  }
  return code;
}

export async function verifyOtp(key: string, code: string): Promise<boolean> {
  // A 6-digit code (1M combinations) had no attempt limit at all — guessable within the 5-minute
  // TTL by a high-volume attacker. Keyed by the same key issueOtp used, so it's a per-phone-number
  // boundary, not global.
  if (!(await checkRateLimit(`otp-verify:${key}`, 8, OTP_TTL_MS))) return false;

  const entry = await platformDb.otpCode.findFirst({ where: { key, code }, orderBy: { createdAt: "desc" } });
  if (!entry) return false;
  if (Date.now() > entry.expiresAt.getTime()) {
    await platformDb.otpCode.delete({ where: { id: entry.id } }).catch(() => {});
    return false;
  }
  // Single-use: delete on successful verification. Also clears any other still-live codes for this
  // key so a stale earlier code can't be replayed after a newer one was already consumed.
  await platformDb.otpCode.deleteMany({ where: { key } });
  return true;
}
