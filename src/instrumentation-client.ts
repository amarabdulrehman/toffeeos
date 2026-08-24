import * as Sentry from "@sentry/nextjs";

// Browser-side coverage (React render errors, uncaught client exceptions) — needs
// NEXT_PUBLIC_SENTRY_DSN specifically, since only NEXT_PUBLIC_* env vars reach the client bundle.
// Same safe-no-op-without-a-DSN contract as the two server-side config files.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
