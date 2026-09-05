# E2E test suite

Playwright tests that drive the real app (real browser, real database — the same demo tenant,
`karachi-karahi`, used throughout manual testing) rather than mocking anything. Built to catch the
exact class of bug that slipped through before: the tax-rate overcharge and the tables-cache gap in
this suite were both found *while writing these tests*, not before.

## Running

```bash
npm run test:e2e          # headless, CI-style output
npm run test:e2e:headed   # watch it drive a real browser window
npm run test:e2e:ui       # Playwright's interactive UI mode — best for debugging one test
```

The config starts its own dev server on port **3100** (never 3000/3010, so it never fights an
interactive `npm run dev` session) and tears it down after. First run installs nothing extra as
long as `npx playwright install chromium` has been run once on the machine.

## How auth works

`global-setup.ts` logs in as every seeded role once via the real NextAuth HTTP flow (not the UI —
same CSRF-token-then-credentials-POST sequence the login form itself performs) and saves each
session as Playwright storage state under `.auth/` (gitignored). Every spec then just does:

```ts
test.use({ storageState: authFile("cashier") }); // or "owner", "kitchen", "rider", "manager", "waiter"
```

## Cleanup

`global-teardown.ts` voids every order this run left `OPEN`/`SENT_TO_KITCHEN`/`READY` and resets
every table back to `AVAILABLE`. Without this, repeated runs permanently eat the demo branch's
fixed table pool — verified this actually happens (see the overnight hardening session's log) and
that the teardown actually fixes it (ran the full suite twice back-to-back, 18/18 both times).

**One real limit, not a bug**: `e2e/tenant-isolation.spec.ts` signs up a fresh tenant through the
real public `/api/signup` endpoint, which is rate-limited to 3/hour per IP by design. Running that
one file more than 3 times an hour from the same machine will fail at its `beforeAll` step with a
429 — that's the rate limiter working, not tenant isolation breaking.

## What's covered

- `pos-payment-correctness.spec.ts` — the exact cash→card overcharge bug, as a regression test
- `role-permissions.spec.ts` — server-side permission boundaries for all 6 seeded roles
- `tenant-isolation.spec.ts` — cross-tenant attacks against a freshly signed-up second tenant
- `inventory-and-tax-rules.spec.ts` — soft-delete semantics, tax-rule overlap validation
- `staff-invite.spec.ts` — invite → public accept → login, correct role/branch
- `offline-sync.spec.ts` — real network-level offline/online transitions (not a `navigator.onLine`
  fake — this is what caught the tables-cache and table-picker race bugs)
- `kds-and-online-ordering.spec.ts` — kitchen mark-ready, QR multi-round order merging

## What's still manual / not covered here

Full device/browser-lab coverage (Safari iOS, older Android WebViews), accessibility/WCAG,
load/performance testing (see `prisma/audit-payments.ts` and the load-test notes from the overnight
hardening session instead), and anything requiring the platform-admin account specifically (its
real credentials + MFA aren't something this suite has or should have).
