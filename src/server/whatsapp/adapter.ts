import "server-only";

/**
 * DEV-ONLY stub adapter — same caveats as src/server/auth/otp-store.ts: no real Meta Business
 * account or WhatsApp Business phone number is configured for this deployment, so every "send"
 * here just logs and reports success. Swapping in the real WhatsApp Business Cloud API later is a
 * one-file change: replace this function's body with a POST to
 * https://graph.facebook.com/v20.0/{phone_number_id}/messages using the businessPhoneNumberId /
 * businessAccountId already modeled on WhatsAppSettings, and keep the same return shape so
 * src/server/whatsapp/send.ts doesn't need to change at all.
 */
export async function sendWhatsAppCloudMessage(
  toPhone: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  console.log(`[WHATSAPP STUB] -> ${toPhone}\n${body}\n`);
  return { ok: true };
}
