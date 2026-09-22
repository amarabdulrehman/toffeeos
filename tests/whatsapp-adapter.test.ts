import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The WhatsApp adapter's contract, which is mostly about what it must *not* do.
 *
 * notifyOrderThankYou runs inside the payment path (see its callers in src/server/orders.ts), and
 * send.ts awaits this function with no try/catch, on the strength of its signature promising a
 * resolved result. That was safe while it was a console.log. Now it makes a network call, so every
 * way that call can go wrong — Meta down, Meta slow, Meta angry, DNS gone — has to come back as a
 * value rather than an exception. If any of these ever throws, a café cannot take money because a
 * thank-you message failed.
 *
 * The payload shape matters just as much and cannot be checked any other way until a real Meta
 * account exists: business-initiated messages must be template sends, and a free-text body would be
 * refused for every message this product sends.
 */

const ORIGINAL_FETCH = globalThis.fetch;

async function loadAdapter(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  // server-only throws outside a server component; the adapter imports it purely as a guard.
  vi.doMock("server-only", () => ({}));
  vi.doMock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
  vi.doMock("@/lib/env", () => ({
    env: {
      NODE_ENV: "test",
      WHATSAPP_API_VERSION: "v20.0",
      ...envOverrides,
    },
  }));
  return import("@/server/whatsapp/adapter");
}

const TARGET = {
  phoneNumberId: "1234567890",
  templateName: "daily_summary",
  language: "en",
  params: ["Tuesday", "Gulshan", "14", "Rs 22,400"],
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("WhatsApp adapter", () => {
  it("sends a template message, not free text", async () => {
    // The whole reason this adapter is not a one-line swap. Meta only accepts free text inside the
    // 24-hour window a customer opens by messaging first; everything this product sends is
    // business-initiated, so a body-text send would be refused every time.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    const result = await sendWhatsAppCloudMessage("923001234567", "rendered copy", TARGET);

    expect(result).toEqual({ ok: true, providerMessageId: "wamid.TEST" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/1234567890/messages");

    const body = JSON.parse(init.body as string);
    expect(body.type, "a free-text send would be refused by Meta").toBe("template");
    expect(body.template.name).toBe("daily_summary");
    expect(body.template.language).toEqual({ code: "en" });
    // Order is the contract: Meta fills {{1}}, {{2}} … positionally.
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Tuesday",
      "Gulshan",
      "14",
      "Rs 22,400",
    ]);
    // The rendered string is for our own log, never for Meta — it must not leak into the request.
    expect(init.body as string).not.toContain("rendered copy");
  });

  it("omits components entirely when the template takes no parameters", async () => {
    // Meta rejects an empty components array for a template that declares no variables.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    await sendWhatsAppCloudMessage("923001234567", "hi", { ...TARGET, params: [] });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.template).not.toHaveProperty("components");
  });

  it("reports not-configured when there is no token, and attempts nothing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: undefined });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", TARGET);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.notConfigured).toBe(true);
    expect(fetchMock, "nothing should be attempted without credentials").not.toHaveBeenCalled();
  });

  it("reports not-configured when the branch has no phone number connected", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", { ...TARGET, phoneNumberId: "" });

    expect(result.ok === false && result.notConfigured).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns Meta's rejection into a result rather than an exception", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Template name does not exist", code: 132001 } }), {
        status: 400,
      })
    ) as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", TARGET);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Template name does not exist");
    expect(result.ok === false && result.error).toContain("132001");
    expect(result.ok === false && result.notConfigured).toBeUndefined();
  });

  it("survives a response that is not JSON at all", async () => {
    // A Meta outage serves an HTML error page, and res.json() throws on it.
    globalThis.fetch = vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", TARGET);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("502");
  });

  it("turns a network failure into a result rather than an exception", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND graph.facebook.com");
    }) as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", TARGET);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Could not reach WhatsApp/);
  });

  it("gives up rather than holding the till open when Meta does not answer", async () => {
    // The failure that would actually hurt: not an error, but silence. Without the timeout this
    // await sits in the middle of taking a payment for as long as the socket stays open.
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    ) as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "tok" });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", TARGET);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/did not respond/);
  }, 20_000);

  it("never leaks the access token into the error it returns", async () => {
    // That error string is written to WhatsAppMessageLog.error, which the restaurant can read.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connect failed using Bearer super-secret-token");
    }) as unknown as typeof fetch;

    const { sendWhatsAppCloudMessage } = await loadAdapter({ WHATSAPP_ACCESS_TOKEN: "super-secret-token" });
    const result = await sendWhatsAppCloudMessage("923001234567", "hi", TARGET);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).not.toContain("super-secret-token");
  });
});
