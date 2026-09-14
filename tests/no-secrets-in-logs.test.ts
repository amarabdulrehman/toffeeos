import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Development stubs must not print their payload in production.
 *
 * Three adapters fall back to console.log when their provider is unconfigured — email, WhatsApp
 * and OTP. In development that is the feature: it is how you read a password-reset link without a
 * mail provider. In production the same line writes a live account-takeover token into the
 * platform's request logs, where it persists and is readable by anyone with log access.
 *
 * That was not hypothetical. The email stub shipped ungated while Resend was unconfigured, so
 * every password reset — including a *platform admin* reset, which grants the super-admin console
 * — logged its own token. The OTP stub had been gated for exactly this reason and the other two
 * were missed, which is what makes this worth a test rather than a memory.
 *
 * Read as text: these files import `server-only`, which throws under vitest.
 */

const STUBS = [
  { file: "server/email/adapter.ts", marker: "[EMAIL STUB]", carries: "a password-reset link" },
  { file: "server/whatsapp/adapter.ts", marker: "[WHATSAPP STUB]", carries: "a customer phone number and message body" },
  { file: "server/auth/otp-store.ts", marker: "[OTP STUB]", carries: "a login code" },
];

const GUARD = /env\.NODE_ENV\s*!==\s*"production"|otpDeliveryAvailable\(\)/;

describe("development stubs", () => {
  for (const stub of STUBS) {
    it(`${stub.file} does not print ${stub.carries} in production`, () => {
      const src = readFileSync(path.join(__dirname, "..", "src", stub.file), "utf8");

      const logLine = src.split("\n").findIndex((l) => l.includes(stub.marker) && l.includes("console.log"));
      expect(logLine, `no console.log carrying ${stub.marker} — did the marker change?`).toBeGreaterThan(-1);

      // The guard has to come before the log, and close after it. Checking only that the file
      // mentions NODE_ENV somewhere would pass a guard sitting in an unrelated function.
      const before = src.split("\n").slice(0, logLine).join("\n");
      expect(
        GUARD.test(before),
        `${stub.marker} is logged without a non-production guard above it. In production this ` +
          `writes ${stub.carries} into the request logs.`
      ).toBe(true);
    });
  }

  it("the email adapter reports an unconfigured provider instead of claiming success", () => {
    // It used to return ok:true when nothing had been sent, so a user got no email, no error, and
    // the only trace was the token sitting in the log.
    const src = readFileSync(path.join(__dirname, "..", "src/server/email/adapter.ts"), "utf8");
    expect(src).toContain("Email delivery is not configured.");
    expect(src).toMatch(/Sentry\.captureException/);
  });
});
