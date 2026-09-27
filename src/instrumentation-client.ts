import * as Sentry from "@sentry/nextjs";

// Browser-side coverage (React render errors, uncaught client exceptions) — needs
// NEXT_PUBLIC_SENTRY_DSN specifically, since only NEXT_PUBLIC_* env vars reach the client bundle.
//
// Initialised only when that DSN is set. Without it Sentry can report nothing from the browser,
// but init still set up its integrations (tracing, instrumentation of fetch and navigation) on
// every page — POS and KDS included — for nothing. With the DSN set, nothing changes.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === "production",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
