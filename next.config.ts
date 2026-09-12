import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// The app's actual external origins, read at build time — kept specific rather than wildcarded so
// the policy only trusts hosts this app genuinely talks to.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWsOrigin = supabaseOrigin.replace(/^https:/, "wss:");
const sentryIngestHost = process.env.SENTRY_DSN ? new URL(process.env.SENTRY_DSN).host : "";

// A pragmatic CSP, not a maximum-strictness one: script-src/style-src keep 'unsafe-inline' because
// Next.js's own hydration scripts and several UI libraries (Recharts, Base UI) inject inline
// script/style without a nonce, and wiring per-request nonces through App Router correctly needs
// more surface-wide testing than a single pass can responsibly cover. This still blocks the two
// things that matter most for this app's actual threat model — loading a script/connecting to a
// domain that ISN'T one of the ones listed below — which is the real value of a CSP even without
// 'unsafe-inline' removed. next/font self-hosts Google Fonts at build time (no fonts.googleapis.com
// dependency at runtime), so font-src only needs 'self'.
// React dev mode uses eval() for its debugging features (stack-trace reconstruction, Fast
// Refresh) — "React will never use eval() in production mode" per its own warning, so this only
// loosens the policy for `next dev`, never for what actually ships.
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `font-src 'self' data:`,
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWsOrigin}` : ""}${sentryIngestHost ? ` https://${sentryIngestHost}` : ""}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
  // Both would fall back through child-src to script-src/default-src ('self') and be allowed in
  // theory, but registration failed in practice until they were stated outright, and relying on a
  // fallback chain for the thing that makes the till work offline is not worth the cleverness.
  // public/sw.js is what lets the POS open with no connection; the manifest makes it installable.
  `worker-src 'self'`,
  `manifest-src 'self'`,
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: csp },
];

/**
 * Identifies this build to the service worker, which drops its cached pages whenever it changes.
 *
 * The commit SHA on Vercel; a timestamp locally, where every `next build` is legitimately a new
 * build. The service worker's own CACHE_VERSION is a constant someone has to remember to bump, and
 * the first time it was forgotten a tablet kept serving the previous build's POS offline. This
 * removes the remembering.
 */
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Safe with no Sentry project configured — org/project/authToken are all left unset, which makes
// the plugin skip source-map upload (just a build-time warning) rather than fail the build. Set
// SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN alongside SENTRY_DSN to enable it for real.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
