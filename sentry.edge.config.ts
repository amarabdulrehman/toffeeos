import * as Sentry from "@sentry/nextjs";

// Covers src/proxy.ts (Next 16's middleware file) and any other edge-runtime code — same
// dsn-unset-is-a-safe-no-op contract as sentry.server.config.ts.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});
