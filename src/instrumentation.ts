import * as Sentry from "@sentry/nextjs";

// Next.js's instrumentation hook — runs once per runtime at process start, before any request.
// Loads the matching Sentry config (sentry.server.config.ts / sentry.edge.config.ts) for whichever
// runtime this process actually is; both are safe no-ops with no SENTRY_DSN set.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
