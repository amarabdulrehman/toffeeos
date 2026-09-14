import "server-only";
import { env } from "@/lib/env";

/**
 * DEV-ONLY stub adapter — same caveats as src/server/auth/otp-store.ts: no real Meta Business
 * account or WhatsApp Business phone number is configured for this deployment, so every "send"
 * here just logs and reports success. Swapping in the real WhatsApp Business Cloud API later is a
 * one-file change: replace this function's body with a POST to
 * https://graph.facebook.com/v20.0/{phone_number_id}/messages using the businessPhoneNumberId /
 * businessAccountId already modeled on WhatsAppSettings, and keep the same return shape so
 * src/server/whatsapp/send.ts doesn't need to change at all.
 *
 * IMPORTANT when making that swap: src/server/whatsapp/send.ts calls this with a bare `await` and
 * no try/catch, on the strength of this function's signature promising it never throws — that's
 * only true today because this stub is just a synchronous console.log. A real `fetch()` call here
 * MUST catch network errors/timeouts itself and resolve to `{ok:false, error}` (mirroring
 * src/server/email/adapter.ts's sendEmail, which does exactly this for Resend) — this function is
 * called synchronously from the order-payment hot path (see notifyOrderThankYou's callers in
 * src/server/orders.ts), and an uncaught exception or a hung request here would fail or stall a
 * successful payment over a WhatsApp message that was never supposed to be able to do that.
 */
export async function sendWhatsAppCloudMessage(
  toPhone: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Customer phone numbers and message text are personal data; they belong in the tenant's own
  // message log (src/server/whatsapp/send.ts records both), not in the platform's request logs,
  // where they persist and are readable by anyone with log access. Same reasoning as the email
  // and OTP stubs.
  if (env.NODE_ENV !== "production") {
    console.log(`[WHATSAPP STUB] -> ${toPhone}\n${body}\n`);
  }

  // Deliberately still ok:true. No provider is wired up at all yet, so returning false here
  // would flip every WhatsApp message in every tenant's log from SENT to FAILED at once — a
  // visible change to clients that should be a decision, not a side effect of a logging fix.
  return { ok: true };
}
