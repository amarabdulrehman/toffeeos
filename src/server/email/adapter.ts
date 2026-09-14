import "server-only";
import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";
import { env } from "@/lib/env";

/**
 * Sends via Resend when RESEND_API_KEY + EMAIL_FROM are set; otherwise falls back to the original
 * dev-stub (console.log) — same inert-until-configured pattern as Sentry (see sentry.server.config.ts),
 * so this is safe to ship either way and activates the moment those two env vars are added, with no
 * further code change. src/server/password-reset.ts is the only caller.
 */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!resend || !env.EMAIL_FROM) {
    /**
     * In development, printing the whole email is the point — it is how you get the reset link
     * without a mail provider.
     *
     * In production it is an account-takeover hole. Both callers put a live password-reset link
     * in the body (src/server/password-reset.ts), one of them for a *platform admin*, and Resend
     * is not configured — so every reset request wrote a token granting that account into the
     * platform's request logs, where it persists and is readable by anyone with log access. The
     * OTP stub was gated to non-production for exactly this reason; this one was missed.
     *
     * It also returned ok:true, so nothing anywhere knew the mail had not been sent.
     */
    if (env.NODE_ENV !== "production") {
      console.log(`[EMAIL STUB] -> ${to}\nSubject: ${subject}\n${body}\n`);
      return { ok: true };
    }

    // Never the body, and never the address: that a send was attempted is all the log needs,
    // and Sentry gets enough to act on without carrying the secret.
    Sentry.captureException(new Error("sendEmail called with no email provider configured"), {
      tags: { area: "email" },
      extra: { subject },
    });
    return { ok: false, error: "Email delivery is not configured." };
  }

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    text: body,
  });

  if (error) {
    console.error("[Resend] send failed:", error);
    // Callers (currently only password-reset.ts) deliberately never let a send failure change what
    // the requester sees — surfacing "your email failed to send" instead of the generic
    // "if that account exists…" message would itself leak whether the account exists. That's the
    // right call for the anti-enumeration contract, but it means a real delivery failure (e.g. this
    // Resend account not yet verified for a custom domain, so it can only deliver to its own owner
    // address) was previously invisible to everyone, including us. Capturing it here — the one
    // choke point every sendEmail call passes through — makes it visible in Sentry without touching
    // that contract.
    Sentry.captureException(new Error(`[Resend] send failed: ${error.message}`), {
      tags: { area: "email" },
      extra: { to, subject, resendError: error },
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
