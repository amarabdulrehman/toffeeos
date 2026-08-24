import "server-only";
import { platformDb } from "@/server/db";

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

export async function issueOtp(key: string): Promise<string> {
  const code = Math.floor(100_000 + Math.random() * 900_000).toString();
  await platformDb.otpCode.create({ data: { key, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  console.log(`[OTP STUB] ${key} -> ${code} (expires in 5 min)`);
  return code;
}

export async function verifyOtp(key: string, code: string): Promise<boolean> {
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
