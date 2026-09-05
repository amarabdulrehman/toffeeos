# Overnight hardening pass — running log

## Addendum — "fix everything you flagged" follow-up (same day, you're now awake)

Went back through every item flagged in the morning report and either fixed it, or determined it
genuinely isn't something I can fix, with evidence either way:

- **pg deprecation warning**: investigated properly this time instead of leaving it as a footnote.
  Tried converting `tenantDb()` to an interactive transaction (my original hypothesis for the
  cause) — typechecked clean, but `node --trace-deprecation` proved the warning still fired,
  and pinpointed the real source: Prisma's own client-side query interpreter
  (`@prisma/query-plan-executor`) fans a `findMany`'s nested `include`s out into separate
  sub-queries dispatched concurrently against the one connection a transaction holds. Confirmed
  it's not query-shape-deterministic either (the identical nested-include request triggered it on
  one run and not the next — a real timing race, not something restructuring the query fixes).
  Confirmed it's harmless for correctness (RLS's `set_config` scope covers the whole transaction
  regardless of how many sub-queries race inside it). Reverted my transaction-form change — it
  didn't fix anything and I hadn't validated it doesn't cost anything on the app's hottest code
  path, so shipping it for zero benefit wasn't worth the risk. Left a comment on `db.ts` recording
  exactly what was tried and why, so this doesn't get re-investigated from scratch later.
- **Left-over test tenant** (`overnight-test-complete-tenant`): marked `CANCELLED` via the same
  status field the app already uses for tenant lifecycle — no delete-tenant feature exists, so this
  is the least destructive way to retire it.
- **Untested roles / offline sync** — all closed out live tonight:
  - Kitchen Staff: can access KDS and mark orders ready; correctly blocked from POS order creation,
    staff, tax rules, inventory (all 403 with the specific missing permission).
  - Rider: can see their own delivery orders; correctly blocked from KDS, POS, assigning riders,
    reports.
  - Branch Manager: correctly blocked from `branch.manage`; correctly allowed staff/reports (broader
    operational role than Cashier, narrower than Owner, as designed).
  - **Offline POS sync, both supported paths, tested for real** (not just read): flipped the real
    browser's `navigator.onLine` to false and fired the `offline` event — banner correctly switched
    to "You're offline — orders are being saved on this device." Punched a dine-in order and sent
    it to the kitchen while offline: confirmed via a direct server check that **no order was
    created remotely** while offline (stayed purely local, "1 unsynced"). Flipped back online:
    the queue auto-replayed, "Synced 1 order," and the order appeared server-side seconds later
    with the correct line item and status. Repeated the same round-trip for **paying** an order
    while offline — went back online, payment synced, and the server's `paidPaisa` matched
    `totalPaisa` exactly (no repeat of the overcharge-class bug via this path). Also confirmed the
    one explicitly-unsupported case (adding items to an already-sent order while offline) degrades
    to a clean error toast, not a crash — exactly as its own code comment says it's designed to.
- **Domain purchase + Resend verification, and the Terms of Service / Privacy Policy legal
  review** — genuinely can't do either of these myself. The domain purchase needs your own payment
  method and registrar account; the legal review needs an actual lawyer, not a plausible-sounding
  draft from me. Both are exactly where they were — not because I skipped them, but because they
  were never code problems.



Started: 2026-08-31 (session continuation, autonomous, no pauses for confirmation per user instruction)

Format: timestamped entries as work happens. Nothing marked done without live re-verification.

---

## Part 1a — Inventory item delete

**Fixed.** `InventoryItem` has required (non-nullable) FKs from `StockMovement`, `StockLevel`, and
`RecipeLine` — a hard delete would either fail once any history exists, or (if forced) corrupt past
stock reports/recipe costings. `isActive` already existed on the model and `listItems`/`stockReport`
already filter on it, so I used the same established archive pattern: `isActive: false`.
Confirmed via code trace that existing RecipeLine references keep rendering (menu-view.tsx reads
`line.inventoryItem.name` from the include, not from the filtered items list) and recipe
consumption (`recipes.ts`) never filters by isActive — so archiving an item mid-use in a recipe
does not break anything already relying on it.

Changes: `archiveItem()` in `src/server/inventory.ts`, new `DELETE /api/inventory/items/[itemId]`,
delete button + confirmation dialog in `ItemsTab` (inventory-view.tsx), mirroring the existing
`CancelOrderDialog` Dialog pattern rather than introducing the unused AlertDialog primitive.

Live re-verification: pending (queued with the rest of the UI regression pass in Part 3, will
create/delete a real test item via the browser and confirm it disappears from pickers but survives
in history).

## Part 1b — Tenant password reset emails not arriving

**Root cause confirmed with live evidence, NOT fully fixable tonight — flagged for you, see top of
final report.**

Traced the whole pipeline: `ForgotPasswordDialog` → `POST /api/auth/request-password-reset` →
`requestTenantPasswordReset` → `sendEmail`. Every step is correctly wired and IDENTICAL in shape to
the platform-admin path (same adapter, same token flow) — there is no separate "tenant path never
wired up" bug as hypothesized.

Reproduced live against production (not a new deploy — just calling the existing live API):
```
POST https://toffeeos.vercel.app/api/auth/request-password-reset
{"tenantSlug":"karachi-karahi","email":"owner@karachikarahi.pk"}
-> 200 {"message":"If that account exists, we've sent a password reset link to its email."}
```
Then pulled the real Vercel function log for that request:
```
[Resend] send failed: { statusCode: 403, name: 'validation_error',
  message: 'You can only send testing emails to your own email address
  (amarabdulrehman123@gmail.com). To send emails to other recipients, please verify a domain
  at resend.com/domains, and change the `from` address to an email using this domain.' }
```
**Root cause**: Resend is still in sandbox mode (`EMAIL_FROM=onboarding@resend.dev`, no custom
domain verified yet — this has been a known pending item since the domain purchase was deferred).
Resend hard-rejects sending to anyone except the account's own verified address. The platform
admin's login email happens to BE that address, so platform resets "work"; every tenant user uses a
different email, so every tenant reset silently fails. This is not a code bug in the tenant path —
it is the exact same code, hitting an external restriction that only manifests for non-owner
recipients. Confirmed no other tenant-facing email exists to carry the same gap (`sendEmail` has
exactly 2 call sites, both in password-reset.ts; staff invites are surfaced as a copyable in-app
link, never emailed).

**What I actually fixed**: the failure was completely invisible — `sendEmail`'s `{ok:false,error}`
was discarded by both callers, so a real delivery failure looked identical to success, with nothing
beyond a raw console.error. Added `Sentry.captureException` at the one choke point every send passes
through (`src/server/email/adapter.ts`), tagged `area: email`, without changing the user-facing
generic message (changing that would break the deliberate anti-enumeration contract — a requester
must never be able to tell "account doesn't exist" apart from "account exists but the email failed
to send"). This does not fix delivery — it makes the next failure visible in Sentry instead of only
in raw logs nobody's watching.

**What I verified locally** (dev-stub email, no RESEND_API_KEY set in .env/.env.local so sendEmail
console.logs instead of calling Resend): confirmed the rest of the pipeline — token issuance,
30-minute expiry, single-use consumption, and login with the new password — is correct end to end
(see Part 3 regression log for the actual run). This isolates the bug to Resend sandbox delivery
only; nothing else in the reset flow is broken.

**Not resolved, and can't be tonight**: real email delivery to tenant users' actual inboxes stays
broken until the domain is purchased and verified with Resend, and `EMAIL_FROM` is switched off the
sandbox sender — a business step outside tonight's scope (no purchasing per your ground rules, and
this was already the known plan). Once that happens, no further code change is needed — the adapter
already does the real Resend send whenever `RESEND_API_KEY`/`EMAIL_FROM` point at a verified domain.

**Full live re-verification, done on my own dev server on port 3010** (port 3000 on this machine is
a different, unrelated project's dev server tonight — confirmed before touching anything, left
completely alone): using the dev-stub email path (no Resend keys set locally, so it behaves exactly
like the "email delivery working" case would), ran the real HTTP flow end to end against the demo
tenant (karachi-karahi / owner@karachikarahi.pk):
1. `POST /api/auth/request-password-reset` → 200, generic message, real token row created in DB,
   TTL ≈30 min.
2. Grabbed the real reset link from the stub log, `POST /api/auth/reset-password` with a new
   password → `{ok:true}`.
3. Replayed the same token → correctly rejected as invalid/expired (single-use enforced).
4. Manually created an already-expired token row → correctly rejected.
5. Logged in via the real NextAuth `credentials` provider with the NEW password → real session
   returned with correct owner permissions.
6. Restored the demo account's password back to the seed default (`Passw0rd!`) afterward so the
   demo environment isn't left in a surprising state.

This proves the entire reset mechanism (token issuance, expiry, single-use, password update, login)
is correct — the ONLY broken link is the Resend sandbox delivery restriction described above.
Did not live-test the platform-admin reset path with the real admin account tonight, deliberately —
that would mean changing the real production admin's password unsupervised, which crosses into
"customer-facing production credential change" territory I was told to avoid touching without you.
Code review confirms it's the identical code path (same `resetPassword` function, same token table),
and the dev server compiled the `adapter.ts` Sentry-capture change with no errors, so risk of
regression there is low, but this one specific case is asserted from code review, not a fresh live
test — flagging that distinction rather than blurring it.

## Part 2 — Error boundaries + crash hunting

**Added route-segment error boundaries** (Next.js `error.tsx` convention — each replaces only its
own segment's content while the parent layout, e.g. the sidebar or the POS/KDS header, stays
mounted): one per admin screen (dashboard, branches, customers, delivery, hr, inventory, menu,
online-ordering, reports, staff, sync-conflicts, tables, whatsapp), one for the `/app` shell as a
catch-all, one for `/pos`, one for `/kds`. All share `src/components/errors/section-error.tsx`,
which reports to Sentry (tagged by section) — previously only the single root `error.tsx` existed,
meaning any crash anywhere in the whole authenticated app blanked the entire page including the
sidebar/header (no sign-out, no way back except a manual URL edit). `npx tsc --noEmit` clean after
adding all 16 files.

**Real finding while live-testing the dashboard** (not a guess — reproduced with a full stack
trace): every page load throws a Node `DeprecationWarning: Calling client.query() when the client
is already executing a query... will be removed in pg@9.0`, visible in the Next.js dev overlay
pointing at `RevenueTrendCard` → `salesReport()` in `src/server/reports.ts`. Root-caused it: EVERY
`tenantDb()` operation (the primary way this whole app talks to the DB) is wrapped in
`rawDb.$transaction([set_config, the real query], ...)` — Prisma 7's array-batch transaction form
over `@prisma/adapter-pg`. Traced the adapter's actual source
(`node_modules/@prisma/adapter-pg/dist/index.js`): `startTransaction()` correctly checks out a
dedicated connection via `pool.connect()` per transaction (confirmed by reading the adapter code,
not assumed) — so this does NOT mean different requests/tenants share a connection or that
transactions cross-contaminate; the warning is an artifact of how the array-batch form dispatches
its two internal statements against that one adapter, not a tenant-isolation bug. **Currently
cosmetic — it hasn't caused a single observed crash or wrong-tenant result** — but it sits on a
deprecation path pg intends to make a hard error in v9, which would then break every tenant-scoped
query in the app on that future upgrade. Deliberately NOT touching the `$transaction([...])` pattern
itself tonight: it's the single hottest code path in the app, already carefully tuned and measured
(see the doc comments in `src/server/db.ts` — 4 round trips vs. 1, P2028 retry logic), and changing
it blind under time pressure risks a worse regression than the warning itself. Flagging this
clearly as a real, open finding rather than silently living with it or silently "fixing" it
riskily — see the top-line flags in the final report. Will specifically re-verify tenant isolation
holds under real concurrent load in Part 5 given this is exactly the kind of pattern that could hide
a cross-tenant leak if the adapter behaved differently than its source shows.

Continuing: live-clicking through every nav item as owner, watching console/network on each,
before revisiting the feature-toggle prime suspect with live tenant-toggle scenarios.

**Part 1a live re-verification (done here, alongside crash-hunting)**: created a real test item
("ZZZ Test Delete Item") via Inventory > Items, deleted it through the new confirm dialog, confirmed
it disappeared from the active list, then confirmed directly in the database it was soft-deleted
(`isActive: false`, row fully intact, not hard-deleted). Matches the design. No console errors, no
crash. Part 1a is now fully closed.

Screens checked so far with no crash and no unexpected console error (only the known pg
deprecation warning, present on every page since it fires on ~every tenantDb() call): Dashboard,
Tables, Menu, Inventory (all 6 tabs touched via the delete test).

All 13 admin screens + Dashboard now walked live as the owner (Delivery, Customers, Branches,
Staff, WhatsApp, Online Ordering, Reports incl. Cancellations tab, HR & Payroll incl. Payroll tab,
Sync Conflicts) — **zero crashes found**. Two things that looked suspicious turned out to be
false alarms on closer check, worth recording so I don't re-flag them later:
- Staff screen briefly showed an empty table before the client fetch resolved — a real (minor)
  loading-state gap, not a crash; noted for Part 4.
- HR > Payroll showed a cashier's computed gross pay (Rs 2,003) not matching her "Paid" badge
  (Rs 2,379) for the selected date range. Checked `src/server/hr.ts` — disbursements are matched by
  date-range *overlap*, not exact match, specifically so "a manager re-running payroll with a
  slightly different date range shouldn't hide a disbursement" (the code's own comment). This
  disbursement was recorded against a wider/different period than the one currently selected — by
  design, not a bug.
- Branches > Order settings showed 4 tax rules stacked (Cash (PRA) 16%, Card & digital (PRA) 8%,
  plus two older "sales tax" rows at 5%/16%) — leftover from earlier test data, not created tonight.
  Flagged to check for double-taxation during the live order/payment test in Part 3, not assumed
  either way.

Moving to Part 3's live order-flow test now, which also verifies the PRA tax-rate switching and
settles the tax-rule-stacking question above with a real order total instead of guessing from the
settings screen.

## Part 3 — Full regression, two real bugs found and fixed via live testing

### Bug: wrong tax rate could apply with zero warning when tax rules overlap

Live-reproduced. Dine-in order, Rs 930 subtotal, sent to kitchen, cash tax showed 16% correctly.
Card tax showed **5%**, not the branch's actual "Card & digital (PRA) 8%" rule. Root-caused via
`resolveTaxRate()` in `src/lib/pricing.ts`: it does `active.find(r => r.paymentMethods.includes(method))`
— whichever active rule happens to come first wins, with zero conflict detection. This demo branch
had 4 tax rules: the correct "Cash (PRA)"/"Card & digital (PRA)" pair was switched OFF, and two
generically-named leftover "sales tax" rules (16% cash, 5% card — from earlier ad-hoc testing this
session) were left ON, so card payments were silently taxed at the wrong rate.

Fixed at the root, not just the data: added `taxRulesOverlap()` to `src/lib/pricing.ts` and wired it
into both `POST /api/tax-rules` and `PATCH /api/tax-rules/[id]` — creating or activating a rule that
would cover the same payment method as another already-active rule is now rejected with a clear
400 ("X is already active and covers one of the same payment methods..."), instead of silently
allowed. Verified the validation actually blocks it (`curl PATCH` on the stale rule → 400 with that
exact message). Also fixed this demo branch's own data back to the correct PRA pair (deactivated
the two "sales tax" duplicates, reactivated "Cash (PRA)" 16% / "Card & digital (PRA)" 8%) so it's no
longer misconfigured itself.

### Bug (more serious): switching payment method after opening "Take payment" could overcharge the customer

Live-reproduced with real money math, not a display glitch. Order total Rs 290 (Dahi Bhalla, cash
16% tax). Opened Take Payment (defaults to Cash, amount field auto-fills "290.00"), switched the
method dropdown to Card. The "Amount due" banner correctly recalculated to Rs 270 (8% card rate,
live preview fetch confirmed via network tab: `rateBasisPoints: 500` → after the tax-rule fix,
`800`) — **but the actual tender amount input stayed at "290.00"**, untouched by the method switch.
"Fully covered" still showed (over-tendered reads the same as a legitimate cash overpayment), so
Confirm was not blocked. Confirmed payment: receipt read "TOTAL Rs 270.00 / Card Rs 290.00". Checked
the database directly — `Order.totalPaisa: 27000`, `Order.paidPaisa: 29000`, a real persisted
`Payment` row for the higher amount. **The customer would have been charged Rs 20 more than the
order actually totaled — real money, not a cosmetic bug.**

Root cause: `src/components/pos/payment-dialog.tsx`'s single tender's `amountRs` is only set once
at mount (from the order's original cash-assumed total) and never resynced when the live preview
recalculates a different total for a different method. There is no legitimate case where a single
(unsplit) tender should differ from the amount due — the UI already blocks confirming with any
"remaining" balance, so partial payment only happens via adding a second (split) tender, which this
fix leaves untouched.

Fix (first pass): a `useEffect` that pinned a lone tender's amount to the live due total. Worked,
but `eslint` (run before the build, per Part 6) caught `react-hooks/set-state-in-effect` on it —
this codebase already has an established convention for exactly this situation (derived/"optimistic
override" state instead of an effect that calls setState), used elsewhere in reports-view.tsx from
earlier this session. Refactored to match: `effectiveTenders` is now computed at render time
(single tender's amount always equals the live due total, split tenders untouched), used for
display, the due-total math, and what `confirm()` submits — no effect, no lint violation. The
single-tender amount input is now `disabled` while showing the correct live value, which is also a
better UX than a text box that silently reverted anything typed into it.

Re-verified live end to end twice — once against the effect-based version, again against the
final derived-state version after the refactor:
- Fish Pakora, Rs 580 cash -> Card: amount field updated to "540.00", receipt "TOTAL Rs 540.00 /
  Card Rs 540.00", DB `totalPaisa: 54000` === `paidPaisa: 54000`.
- Vegetable Samosa, Rs 232 cash -> Card (post-refactor): amount field showed disabled "216.00",
  receipt "TOTAL Rs 216.00 / Card Rs 216.00", exact match.

`npx tsc --noEmit` and `npx eslint src prisma tests` both clean after the refactor.

### Online order -> kitchen -> payment -> WhatsApp thank-you, full path re-verified

Placed a real order through the public (unauthenticated) online-ordering checkout API for the demo
tenant, paid it, and confirmed each step with real evidence rather than assuming: order landed on
the KDS board immediately (`status: SENT_TO_KITCHEN`, `source: ONLINE`); paying it via
`POST /api/orders/{id}/pay` moved it to `PAID` with `paidPaisa` exactly equal to `totalPaisa`; and
the WhatsApp thank-you stub fired immediately after with the correct interpolated customer name and
restaurant name ("Pleasure having you here at Karachi Karahi House, Overnight Test Customer! Hope
you loved it.") — confirming the per-tenant configurable thank-you trigger built earlier this
session (`ON_PAYMENT`) still fires correctly for an online-channel order, not just POS ones.

### Staff invite -> accept -> login, full path re-verified

Created a real invite via the owner's session (`POST /api/staff/invites`), fetched it from the
public unauthenticated invite-lookup endpoint (confirms the link itself works before anyone logs
in), accepted it with a new password, then logged in as that brand-new staff member and confirmed
the session carries the correct role (waiter), branch (the one the invite targeted, not the
inviter's own), and the waiter permission set — not the inviter's.

### QR ordering across multiple rounds, tier-change overwrite, tenant creation — all re-verified live

- **QR multi-round**: placed two separate QR-checkout orders for the same table (T5) a few seconds
  apart with different items. Confirmed the second call returned the *same* `orderId`/`orderNumber`
  as the first, and the database shows one order with both lines (Beef Chapli Kebab + Dahi Bhalla)
  and the combined total — a second scan at the same table adds to the existing bill, never creates
  a conflicting duplicate order.
- **Tier-change overwrite of custom toggles**: `src/server/platform.ts`'s `changeTenantTier`
  transitively imports something that pulls in `next/navigation`, so it can't be called from a
  standalone script tonight (the same known limitation noted earlier this session for
  `orders.ts`/`triggers.ts`) — and I don't have platform-admin credentials to drive it through the
  real HTTP route either (password changed + MFA enabled earlier this session, correctly, by you).
  Read its exact source instead: `enabledModules: defaultModulesForTier(planKey)` is written
  unconditionally, no merge with the tenant's existing set. Reproduced that exact operation directly
  against the demo tenant's Subscription row (same reads/writes, same `defaultModulesForTier`
  function, just not going through the wrapper that also touches branch-limit checks and audit
  logging): gave the tenant a custom toggle (turned CRM off, which its actual tier would otherwise
  include), then applied the tier-default overwrite — confirmed the custom toggle was silently
  reset, exactly matching what the platform UI's own confirmation dialog warns about ("Any
  per-feature customization you've made will be overwritten"). Restored the tenant's original
  toggle set afterward.
- **Tenant creation with a chosen starting tier**: called `adminCreateTenant` (the exact function
  the platform "create tenant" API route uses) directly with `planKey: "complete"`. Result: new
  tenant landed `ACTIVE` (not `TRIALING` — correct, an admin-provisioned tenant isn't a trial),
  correct Complete-tier module set, one branch, one owner user. Logged in as that owner with the
  generated temp password — succeeded, and the session correctly carries `mustChangePassword: true`
  (the app's layouts redirect to `/change-password` on that flag, confirmed by code, matching the
  password-reset flow's own re-verified plumbing). This created a real extra tenant in the shared
  dev/prod database, `overnight-test-complete-tenant` — left in place rather than risking a
  destructive cleanup step; there's no tenant-deletion feature in the app today (only
  suspend/cancel), and this database already had several older leftover test tenants from earlier
  sessions before tonight.

## Part 4 — Performance, production build

`npm run build` — **zero warnings, zero errors**, all 94 routes compiled, TypeScript check clean.
`npx eslint src prisma tests` clean (after the payment-dialog refactor above). `npx vitest run` —
56/56 tests pass (added 3 for `taxRulesOverlap`).

Ran a real concurrent-load test against the **production build** (`next start`, not dev mode) on
this machine:

| Route | Concurrency | p50 | p95 | max | Result |
|---|---|---|---|---|---|
| `/login` (static/no-DB) | 25 | 61ms | 62ms | 62ms | 25/25 OK |
| Public online-order menu (DB-backed) | 10 | 3.6s | 3.7s | 3.7s | 10/10 OK |
| Public online-order menu | 50 | 11.0s | 13.6s | 14.9s | 50/50 OK, zero errors |
| Public online-order menu | 100 | 1.2s | 1.7s | 1.8s | **100/100 → HTTP 429** |

**Important caveat on the absolute numbers**: this machine is testing over the real network to the
live Supabase instance in Singapore, from local hardware nowhere near it — the DB-backed route's
3-15s latency is dominated by that physical distance, not app inefficiency. The actual Vercel
deployment runs in `sin1` (Singapore, same region as the DB, set deliberately in `vercel.json`), so
production latency for this same route should be dramatically lower than what's shown here — I
don't have a way to measure the real number from this machine tonight, and I'm not going to
pretend otherwise. What **is** representative regardless of network distance: zero errors up to 50
concurrent requests (no crashes, no P2028 failures reaching the client, no 500s), and the
concurrency=100 result isn't a failure at all — it's the existing per-(tenant, IP) rate limiter
(60 requests/minute) correctly kicking in once my own test traffic (all from one IP) crossed that
threshold. That's the safeguard working as designed, not a bug.

Re-confirmed the pg `client.query()` deprecation warning from Part 2 fires on essentially every
DB-touching request in both dev and the production build — same finding, not new, just re-observed
under load. Still not touching the `$transaction([...])` pattern itself tonight (see Part 2's
reasoning); flagged again at the top of the final report as something to revisit before ever
bumping the `pg` package to v9.

## Part 5 — Security, re-verified

- **Exposed secrets**: grepped source (`src`, `prisma`) for common hardcoded-secret shapes (Stripe-
  style keys, AWS keys, private-key blocks, Resend-style tokens, `PASSWORD`/`SECRET`/`TOKEN`
  literals) — none found. Grepped the actual production **client bundle**
  (`.next/static/**`) for server-only env var names (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AUTH_SECRET`, `RESEND_API_KEY`, `PLATFORM_DATABASE_URL`, `CRON_SECRET`) — none leaked into
  client-shipped JS.

- **Real gap found and fixed**: `POST /api/auth/request-otp` (public, unauthenticated — issues a
  rider/staff phone-login OTP for any phone number in the request body) had **zero rate limiting**,
  the only public auth route missing it — every sibling route (signup, both online-order checkout
  routes, both password-reset-request routes, reset-password itself) already had it. Today's
  impact is an unbounded `OtpCode` row per request (DB-flooding); the moment real SMS/WhatsApp OTP
  delivery is wired up (explicitly deferred per your own earlier decision), this same gap becomes a
  free per-message cost-abuse vector against any phone number an attacker chooses. Fixed with the
  exact same convention already used everywhere else (`checkRateLimit`, 5 requests/15 min per IP).
  Verified live: 5 requests succeed, the 6th and 7th both correctly return 429.

- **Tenant isolation under the per-feature toggle system**: re-verified with real cross-tenant
  attempts (see Part 3) — void/read on another tenant's order (404), platform-only feature-toggle
  route rejected under a tenant session (401), PATCH/DELETE on another tenant's real tax-rule ID
  (404, confirmed untouched afterward). No leakage or mutation possible.

- **Every gated endpoint re-confirmed server-side, not just UI-hidden**: logged in as the seeded
  Cashier and hit five endpoints outside their permission set directly — HR payroll, tax rules,
  staff list, inventory items, branches — all five correctly 403 with the specific missing
  permission named, while cashier-appropriate endpoints (orders, menu) still worked. This is the
  live re-verification Part 5 asked for given the per-feature model changed since it was first
  built.

## Part 6 — Production-readiness checklist

- **Zero build warnings/errors**: confirmed (`npm run build`, see Part 4).
- **Env vars separated dev/production, nothing hardcoded**: grepped source for hardcoded secrets —
  none. `.env` (which has `NODE_ENV="development"` and other local values) is gitignored
  (`.env*` in `.gitignore`) and not committed — confirmed it's genuinely local-only via
  `git ls-files .env` (empty). Vercel's real production env vars are managed separately via
  `vercel env` (already set from earlier this session) and are untouched tonight.
- **Error monitoring**: Sentry already wired (`Sentry.captureException` in `defineHandler`'s
  catch-all, the root `error.tsx`, and now every new per-screen `error.tsx` from Part 2, plus the
  new capture in the email adapter from Part 1b).
- **Migrations clean and repeatable**: `npx prisma migrate status` against the live database — all
  28 migrations applied, "Database schema is up to date." Did **not** provision a separate fresh
  database to test a true from-zero replay tonight — that would mean standing up new infrastructure,
  which is outside what I should do unsupervised; flagging this as unverified rather than assuming
  it's fine.
- **Graceful degradation**: the email adapter (Resend) already catches failures and returns
  `{ok:false}` rather than throwing (confirmed and hardened in Part 1b). The WhatsApp adapter is
  still a dev-stub that literally cannot fail today (it's a synchronous console.log) — added an
  explicit warning comment to it (`src/server/whatsapp/adapter.ts`) so whoever wires up the real
  Meta Cloud API later knows the send call MUST catch network errors/timeouts itself, because its
  caller (`notifyWhatsApp` in `send.ts`) calls it with a bare `await`, no try/catch, straight from
  the order-payment hot path — the same mistake would otherwise turn a slow WhatsApp API into a
  hung or failed payment request.

**This is the most serious thing found tonight** — it's a real-money overcharge bug that would have
hit actual customers the first time a real cashier took a dine-in order assuming cash, then the
customer decided to pay by card instead (an extremely common real-world sequence). Fully fixed and
re-verified, not just patched to stop the symptom I happened to trigger.

### KDS / payment interaction re-verified intact

Re-confirmed the earlier "orders vanish from KDS as soon as payment is taken" fix from before this
session's compaction is still correct: order #102 was paid via cash while still `SENT_TO_KITCHEN`
(never marked Ready), and it correctly remained on the live KDS board afterward — kitchen still
sees it, exactly as intended. No regression.

### Feature-toggle immediate effect + cross-tenant isolation, re-verified live (ties into Part 5)

Toggled `inventory` off directly on the demo tenant's Subscription (simulating a platform-admin
change) while already logged in as the tenant owner with an existing session — no re-login. Result:
the sidebar's Inventory item disappeared immediately, `/app/inventory` switched to the "isn't
enabled" upgrade screen, and `GET /api/inventory/items` returned 403 "This feature isn't enabled..."
— confirming the server-side gate (not just the UI) enforces it, and confirming tier.ts's own claim
that this is never cached on the session/JWT. Restored the module afterward.

Then tried genuine cross-tenant attacks using this session (karachi-karahi owner) against a
different real tenant ("bigmac", left over from earlier test data) with real IDs, not guesses:
- `POST /api/orders/{bigmac's real order id}/void` -> 404 "Not found" (never revealed the order
  exists, never voided it).
- `PATCH /api/platform/tenants/{bigmac's id}/features` (the platform-only feature-toggle route)
  using a tenant session -> 401 Unauthorized (platform and tenant auth are correctly separate).
- `PATCH` and `DELETE` on bigmac's real tax-rule ID -> both 404, rule confirmed untouched
  afterward by direct DB check.

No cross-tenant leakage or mutation possible through any of these paths. (One process note: my
first attempt at the tax-rule cross-tenant test accidentally used karachi-karahi's own rule ID by
mistake, which correctly succeeded since it *was* my own tenant's resource — caught it immediately
via the response body, reverted the accidental toggle, and re-ran with a real cross-tenant ID.)

### Send to Kitchen -> Kitchen Display -> Payment -> Receipt, full path re-verified

Order #102 (dine-in, 2 items) walked through the complete path live: added to cart -> sent to
kitchen (200 OK) -> appeared on `/kds` -> paid via cash -> receipt matched subtotal/tax/rounding
math exactly (Rs 930 + Rs 149 tax (16%) + Rs 0.20 rounding = Rs 1,079). No crashes, no console
errors beyond the already-documented pg deprecation warning.

