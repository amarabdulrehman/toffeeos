import "server-only";

/**
 * DEV-ONLY stub adapter — same pattern as src/server/whatsapp/adapter.ts: no real email provider
 * is configured for this deployment, so every "send" here just logs and reports success. Swapping
 * in a real provider before going live is a one-file change — Resend is the easiest fit for a
 * Next.js app (a single `resend.emails.send({...})` call, generous free tier): replace this
 * function's body with that call, keep the same return shape, and nothing else in the app needs to
 * change (src/server/password-reset.ts is the only caller).
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  console.log(`[EMAIL STUB] -> ${to}\nSubject: ${subject}\n${body}\n`);
  return { ok: true };
}
