import { defineConfig, devices } from "@playwright/test";

// Deliberately its own port (3100), never 3000/3010 — those are used interactively during
// development (see the overnight hardening session's notes on port conflicts), and this suite
// needs to own its server's lifecycle without racing another session's dev server. AUTH_URL /
// NEXT_PUBLIC_APP_URL are overridden only for the spawned webServer process below, never written
// to .env/.env.local, so this has zero effect on anyone's normal `npm run dev`.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shared demo-tenant data (tables, orders) — parallel runs would race each other
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      AUTH_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
    },
  },
});
