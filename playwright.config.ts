import { defineConfig, devices } from "@playwright/test";

// Deliberately its own port (3100), never 3000/3010 — those are used interactively during
// development (see the overnight hardening session's notes on port conflicts), and this suite
// needs to own its server's lifecycle without racing another session's dev server. AUTH_URL /
// NEXT_PUBLIC_APP_URL are overridden only for the spawned webServer process below, never written
// to .env/.env.local, so this has zero effect on anyone's normal `npm run dev`.
// E2E_PORT overrides it for a machine where 3100 is taken by something else. reuseExistingServer
// attaches to whatever already answers on the port, so a different app there doesn't fail to
// start — it silently becomes the app under test, and every request gets that app's 404 page.
const PORT = Number(process.env.E2E_PORT) || 3100;
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
    /**
     * The till on an iPad, in Safari's engine.
     *
     * Everything above runs in Chrome. Most cafés here run their till on an iPad, and on iOS
     * every browser is WebKit underneath — Chrome for iPad included — so a WebKit-only failure is
     * a failure on the device the till actually lives on. A standard iPad on its side is the usual
     * setup, which is what this emulates: WebKit, 1080x810, Safari's user agent, touch.
     *
     * Only the specs that drive the till, the kitchen and the customer storefront through a real
     * page. The rest are API calls, which do not care what browser sent them, and running them
     * twice would buy an extra twenty minutes and no coverage.
     *
     * Emulation, not a device: it catches engine and layout differences, not iOS's own quirks —
     * the keyboard covering an input, a printer dialog, the app being backgrounded mid-order.
     */
    {
      name: "ipad-safari",
      use: { ...devices["iPad (gen 7) landscape"] },
      testMatch: [
        "pos-payment-correctness.spec.ts",
        "kitchen-ticket.spec.ts",
        "offline-sync.spec.ts",
        "kds-and-online-ordering.spec.ts",
        // Sets its own phone and portrait-tablet sizes, so here it runs as iPhone and portrait-iPad
        // Safari rather than at this project's landscape size.
        "pos-small-screens.spec.ts",
        // Printing on an iPad: the :has() print rule and the page size, in Safari's engine.
        "printing.spec.ts",
        // New-order and ready alerts, on the device most tills are.
        "order-alerts.spec.ts",
        // Waiter orders held for the counter, and the waiter's table panel.
        "order-approvals.spec.ts",
      ],
    },
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
