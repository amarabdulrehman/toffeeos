import * as Sentry from "@sentry/nextjs";

// Browser-side coverage (React render errors, uncaught client exceptions) — needs
// NEXT_PUBLIC_SENTRY_DSN specifically, since only NEXT_PUBLIC_* env vars reach the client bundle.
//
// Initialised only when that DSN is set. next.config.ts defines it at build time (empty when
// unset), so without it the bundler drops the SDK from the browser entirely; set it and redeploy,
// and browser reporting is back with no code change. The error screens' own
// Sentry.captureException calls stay safe either way: with no client they send nothing and return.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === "production",
  });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
