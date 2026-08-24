import * as Sentry from "@sentry/nextjs";

// Ships inert today — Sentry's SDK is a documented, safe no-op when `dsn` is unset. The one manual
// step left before this actually reports anything is creating a (free-tier) Sentry project and
// setting SENTRY_DSN in .env; nothing else needs to change.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Keep noisy dev-server startup logs quiet even once a DSN is configured.
  enabled: process.env.NODE_ENV === "production",
});
