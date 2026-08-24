import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
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
