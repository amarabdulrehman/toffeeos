import "server-only";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

/**
 * Sending through Meta's WhatsApp Cloud API.
 *
 * Inert until configured, exactly like the email adapter: with no access token or no
 * phone_number_id this reports `notConfigured` and nothing is attempted. It used to report success
 * instead, which meant a restaurant's message log filled with messages marked SENT that had never
 * existed — the one outcome worse than the feature being switched off.
 *
 * **Business-initiated messages must be templates.** Meta only allows free text inside the
 * 24-hour window opened by a customer messaging first, and every message this product sends — a
 * daily summary, a win-back, a low-stock alert — is business-initiated. So this sends
 * `type: "template"` with the template's registered name and its parameters in order, not the
 * rendered string. The rendered string is still produced by the caller, because it is what the log
 * shows a restaurant afterwards, but Meta composes the real message from its own approved copy.
 *
 * **It must never throw, and never hang.** notifyOrderThankYou runs inside the payment path (see
 * its callers in src/server/orders.ts), and src/server/whatsapp/send.ts awaits this with no
 * try/catch on the strength of the signature below. An uncaught error would fail a payment that
 * had already succeeded, and a request left hanging on a slow Meta would stall the till mid-sale
 * over a thank-you message. Every path here resolves, and the request carries its own timeout.
 */

/** Long enough for a normal Graph call, short enough that a cashier never waits on one. */
const TIMEOUT_MS = 8_000;

/**
 * Strips the access token out of anything on its way to a caller.
 *
 * Errors from here are written to WhatsAppMessageLog.error, which the restaurant reads in its own
 * message log — and the token is not theirs, it is the platform's, shared by every tenant on it.
 * A fetch failure that quotes the request headers would therefore hand one customer a credential
 * that sends as all of them. Undici does not do that today, but "today" is doing a lot of work in
 * that sentence for something written into a table the wrong people can read.
 */
function redact(text: string, token: string | undefined): string {
  return token ? text.split(token).join("[redacted]") : text;
}

export interface WhatsAppSendTarget {
  /** Meta's phone_number_id for this restaurant's number — per tenant, from WhatsAppSettings. */
  phoneNumberId: string;
  /** The template's registered name in Meta's template manager. */
  templateName: string;
  /** Template language tag as registered, e.g. "en" or "en_US". */
  language: string;
  /** Body parameters, in the order the template's {{1}}, {{2}} … expect them. */
  params: string[];
}

export type WhatsAppSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; notConfigured?: true };

export async function sendWhatsAppCloudMessage(
  toPhone: string,
  renderedBody: string,
  target: WhatsAppSendTarget | null
): Promise<WhatsAppSendResult> {
  const token = env.WHATSAPP_ACCESS_TOKEN;

  if (!token || !target?.phoneNumberId) {
    // Customer phone numbers and message text are personal data; they belong in the tenant's own
    // message log (src/server/whatsapp/send.ts records both), not in the platform's request logs,
    // where they persist and are readable by anyone with log access. Same reasoning as the email
    // and OTP stubs.
    if (env.NODE_ENV !== "production") {
      console.log(`[WHATSAPP STUB] -> ${toPhone}\n${renderedBody}\n`);
    }
    return {
      ok: false,
      notConfigured: true,
      error: token
        ? "This branch has no WhatsApp phone number connected yet."
        : "WhatsApp sending is not configured for this deployment.",
    };
  }

  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${target.phoneNumberId}/messages`;

  // AbortSignal.timeout would be terser, but an explicit controller is what lets the catch below
  // tell a timeout apart from a network error — they mean different things to whoever reads the log.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "template",
        template: {
          name: target.templateName,
          language: { code: target.language },
          // Omitted entirely when there are no parameters: Meta rejects an empty components array
          // for a template that declares no variables.
          ...(target.params.length > 0
            ? {
                components: [
                  {
                    type: "body",
                    parameters: target.params.map((text) => ({ type: "text", text })),
                  },
                ],
              }
            : {}),
        },
      }),
    });

    const payload = (await res.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number; error_subcode?: number };
    } | null;

    if (!res.ok) {
      // Meta's message, not the whole body: the body echoes the request, and the request carries
      // the customer's phone number. The status and code are what a support call needs.
      const detail = payload?.error?.message ?? `HTTP ${res.status}`;
      const code = payload?.error?.code != null ? ` (code ${payload.error.code})` : "";
      return { ok: false, error: redact(`${detail}${code}`, token).slice(0, 500) };
    }

    return { ok: true, providerMessageId: payload?.messages?.[0]?.id ?? null };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    const error = timedOut
      ? `WhatsApp did not respond within ${TIMEOUT_MS / 1000}s.`
      : `Could not reach WhatsApp: ${err instanceof Error ? err.message : String(err)}`;

    // Worth knowing about centrally — a restaurant sees one failed row and has no way to tell a
    // blip from an outage. Deliberately carries no phone number and no message body.
    Sentry.captureException(err instanceof Error ? err : new Error(error), {
      tags: { area: "whatsapp", timedOut: String(timedOut) },
      extra: { phoneNumberId: target.phoneNumberId, templateName: target.templateName },
    });
    return { ok: false, error: redact(error, token).slice(0, 500) };
  } finally {
    // Always, including the success path: an uncleared timer holds the event loop open.
    clearTimeout(timer);
  }
}
