# ToffeeOS — Pre-Launch Hardening Report

**Branch:** `pre-launch-hardening` — never pushed, nothing deployed.
**Base:** `main` @ `ecc0ceb`
**Run date:** 2026-09-09

---

## 1. GO / NO-GO VERDICT

**GO.** I'd ship this to paying clients.

The thing you said matters most — one client seeing another's data — is genuinely well built, and I
mean that after trying to break it rather than after reading it. Isolation is not enforced in the
frontend or even mainly in application code: it's enforced in Postgres. 53 of 56 tables have
row-level security **enabled and forced**, and the runtime database role `app_user` has
`rolbypassrls = false` — I verified both directly against your live database rather than trusting
the migration. On top of that, all 95 tenant-facing routes go through one choke point that sets the
RLS tenant variable *and* independently injects a `tenantId` filter. Two layers, either of which
would hold alone.

I found four real defects and fixed all four. Only one was a data-exposure bug, and it was
**cross-branch, not cross-tenant**: a Branch Manager could read salaries at other branches of the
same restaurant. Bad, absolutely worth catching before launch — but no client could ever have seen
another client's data through it. The blocker I flagged mid-run (rider login codes written to
production logs) is resolved.

Two honest caveats on the verdict:

- **I could not produce production-representative performance numbers** from this machine, and I'd
  rather say that than hand you a figure I don't believe. Details and the exact way to get a real
  one are in §6.1.
- **WhatsApp and rider phone-login are both inert in production.** Neither is a defect — both are
  unbuilt integrations — but if you're selling WhatsApp notifications as a feature, know that they
  no-op today (§6.5).

---

## 2. CRITICAL

Both items originally in this section are now fixed. Kept here rather than moved, because these are
the two you should actually look at in the morning.

### 2.1 — FIXED: Cross-branch salary leak (IDOR) — `870a62e`

`GET /api/hr/payslip/[membershipId]` took the membership id straight from the URL and handed it to
`getPayslip`, which scopes by tenant (RLS) but **not by branch**. A Branch Manager could read any
employee's pay type, hourly rate, monthly salary, hours worked and gross pay at any other branch in
the same restaurant by changing one id.

Demonstrated, not theorised. With the guard removed the seeded Branch Manager gets `200` and:

```json
{"userName":"Other Branch Employee","branchName":"DHA Phase 6",
 "monthlySalaryPaisa":9999900,"grossPayPaisa":9999900, ...}
```

The root cause is worth knowing because it predicts where the next one hides: an earlier pass fixed
exactly this bug class on the HR **write** routes (`pay-profiles` PATCH, `payroll/disburse`) using an
`assertWritableMembership` helper — and missed this **read**. It was the only HR route accepting a
membership or branch identifier without checking it.

New spec `e2e/payslip-branch-isolation.spec.ts` asserts the 403 *and* that the salary appears
nowhere in the body, with two positive controls (manager reading their own branch, owner reading
across branches). Both controls still pass with the guard removed — which is what proves the failing
assertion is the branch check and not the route being broken generally.

### 2.2 — FIXED: Rider login codes written to production logs — `2401b01`

`issueOtp` ran `console.log("[OTP STUB] <phone> -> <code>")` unconditionally, in every environment.
On Vercel that puts a live login credential and a phone number into the log stream in plaintext,
readable by anyone with log access or any drain attached to it, well inside the code's five-minute
validity.

I flagged this as needing your decision because deleting the line looked like it would break the
feature — no SMS/WhatsApp sender is wired up, so that log *was* the only delivery channel. Then the
evidence resolved it: reading a code out of a server log is not a sign-in flow, so rider OTP login
was **already** non-functional in production for any real rider. And riders aren't locked out —
they have ordinary email+password accounts and the standard `/login` page works for them, which is
exactly how `e2e/global-setup.ts` authenticates the rider role today.

So production now says so honestly instead of leaking: `otpDeliveryAvailable()` reports whether a
code can reach anyone, the log is gated behind it, and `request-otp` returns 503 pointing riders at
email+password. That's a property of the deployment, not of the phone number asked about, so it
reveals nothing and doesn't reopen the enumeration hole the unconditional `{ ok: true }` exists to
close. Dev is unchanged. When you wire a real sender, `otpDeliveryAvailable()` becomes a check on
its config and phone login starts working with no other change.

Verified both directions: against a production build, `request-otp` returns 503 and **zero** codes
reach the log; in dev it still returns `{ ok: true }` and still logs.

---

## 3. FIXED

| # | What | Commit |
|---|---|---|
| 1 | Cash-drawer day could never be corrected after a typo — now correctable by Owner/Branch Manager only, audit-logged, original closer preserved | `5e6ba7a` |
| 2 | Two public endpoints returned raw internal error text to anonymous callers | `31e033c` |
| 3 | **Cross-branch salary leak on the payslip route** (§2.1) | `870a62e` |
| 4 | Delivery-proof signed-URL helper accepted any storage path | `b197b8b` |
| 5 | Two dependency advisories patched without a breaking upgrade | `27afd54` |
| 6 | **Rider login codes written to production logs** (§2.2) | `2401b01` |
| 7 | `TENANT_SCOPED_MODELS` had drifted from the schema; pinned with a test | `5f759a8` |
| 8 | SVG dropped from the public logo bucket's allowlist | `6723498` |
| 9 | Added a 404 page | `e92c61e` |

**On #2** — both routes ended with `err instanceof Error ? err.message : "..."` and returned that to
the caller. Both are unauthenticated. Proven by planting an internal error and calling with a
schema-valid body; it came back in full:

```
{"error":"LEAKCANARY-P2002 Unique constraint failed on User.passwordHash at /var/task/src/server"}
```

A real Prisma failure would have handed an anonymous caller the model, constraint, columns and a
server path. One was already reachable in production: `The <plan> plan is not seeded — run
npm run seed first.` Worth noting my *first* attempt at this test was itself masked — an incomplete
body was rejected by the zod schema before the handler ran, which looks like a pass and proves
nothing.

**On #7** — a genuine drift, caught by the test I wrote for it. `ImpersonationToken` and
`PasswordResetToken` both carry a `tenantId` and were missing from the list that decides whether
`tenantDb()` applies scoping. Being precise about severity: both are reached only via `platformDb`,
so nothing routed them through `tenantDb`; and had anything done so, RLS is enabled and **forced**
on both, so the query returns zero rows rather than another tenant's. It fails closed. The cost was
a confusing empty result, not a leak. Both are now listed, and the test fails if the list drifts
again in either direction.

**On #4** — `resolveProofUrl` minted a signed URL for any path handed to it using the service-role
key, which ignores RLS entirely. It's unreferenced today, so this was a latent footgun rather than a
live hole; it now refuses paths outside the caller's own tenant prefix.

---

## 4. NEEDS MY DECISION

You told me to decide, so I did. Here is every call I made on your behalf and the reasoning, so you
can overrule any of them.

### 4.1 — Rider OTP login → **disabled in production.** See §2.2.
Decided because the evidence removed the tradeoff: the feature was already non-functional in
production, and riders have a working email+password path. Reversible the moment you wire a sender.

### 4.2 — SVG logos → **removed from the allowlist** (`6723498`)
Decided on data, not principle: of 64 tenants, one has a logo at all and none is an SVG. It rejects
nothing anyone is using. Raster formats cover every real logo.

### 4.3 — `TENANT_SCOPED_MODELS` drift test → **added** (`5f759a8`), and it immediately found real
drift. See §3 #7.

### 4.4 — 404 page → **added** (`e92c61e`)
Deliberately the same shape as the existing `error.tsx` rather than a new design — I did not invent
any visual language.

### 4.5 — Session lifetime (30 days) → **left alone**
This is the one place I'd push back on "make it perfect", because shorter isn't strictly better. It's
NextAuth's default with no override. It matters less here than it normally would: every request
re-checks the revocation stamp, whether the user is still active, and whether the tenant is still
active — so a token is killable instantly rather than valid-until-expiry, and sign-out genuinely
invalidates it server-side. Shortening it to 7 days mainly means your cashiers log in more often. I
wasn't willing to silently change how often your staff get logged out mid-shift. One line if you
want it.

### 4.6 — `Tenant` table sits outside both isolation layers → **left alone, documented**
`Tenant` has no RLS (it *is* the tenant registry — a tenant-scoped policy is circular) and is
deliberately excluded from auto-injection. Both current call sites scope it correctly by hand
(`where: { id: session.tenantId }`), so there's no bug. But it's the one table where a future
forgotten `where` returns or modifies *other restaurants' rows*, with nothing underneath to catch it.
Adding RLS here breaks login, which must read tenants cross-tenant before a session exists. Genuinely
needs a design decision, not an overnight patch.

### 4.7 — `mysql2` advisory → **left alone**
Reached only through the `prisma` CLI. Both advisories require speaking the MySQL wire protocol to a
hostile server; this app is Postgres-only through `@prisma/adapter-pg` and never loads that driver.
The only offered fix is `npm audit fix --force`, which downgrades Prisma 7.10 → 6.19 — a major
version that removes the driver-adapter API this codebase is built on. Trading a working architecture
for an unreachable advisory is a bad deal.

---

## 5. ENV VARS CHECKLIST

From `src/lib/env.ts`, which validates these at boot (deliberately not at import, so builds don't
need runtime secrets).

**Required — the app refuses to start without these:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Must be the **pooler, port 6543, `?pgbouncer=true`**. Verified correct. |
| `DIRECT_URL` | Direct connection, port 5432. Migrations only. |
| `PLATFORM_DATABASE_URL` | `platform_user` role (BYPASSRLS by design). Pooler, 6543. |
| `NEXT_PUBLIC_SUPABASE_URL` | Also feeds the CSP `connect-src`/`img-src` allowlist at build time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage uploads + signed URLs. Ignores RLS — server-side only. |
| `AUTH_SECRET` | JWT signing. |
| `NEXT_PUBLIC_APP_URL` | Must be the real production URL — used in password-reset email links. |

**Optional, but you almost certainly want them set:**

| Variable | If unset |
|---|---|
| `AUTH_URL` | Defaults from the request. Set it to the production URL — `secure` cookie flags follow the scheme, so keep it `https://`. |
| `CRON_SECRET` | **Both cron endpoints reject every request.** Daily summaries and backups silently stop. |
| `RESEND_API_KEY` | Password-reset emails are logged instead of sent. |
| `EMAIL_FROM` | Same. Currently the Resend sandbox sender — delivers only to your own address until you verify a domain. |
| `SENTRY_DSN` | No error reporting. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Source-map upload skipped (build warning only). |

`NODE_ENV` is set by Vercel — don't set it yourself. Note it now also gates rider OTP login (§2.2).

---

## 6. KNOWN LIMITATIONS

### 6.1 — Load test numbers, and why I don't trust them

Against a local production build, 20 concurrent users:

| Endpoint | p50 | p99 | Throughput | Errors |
|---|---|---|---|---|
| `/login` (SSR page) | 29 ms | 52 ms | ~500 req/s | 0 |
| `/api/orders` (DB-backed) | 7,537 ms | 9,884 ms | 1.9 req/s | 1 timeout |

**Do not read the second row as a production forecast.** My machine talks to your Supabase instance
in `ap-southeast-1` across the open internet — the codebase's own measurements put that at 150–250 ms
*per round trip*. An uncontended single request measured ~1.5 s, i.e. roughly 6–10 sequential round
trips. In production `vercel.json` pins `sin1`, colocated with the database, so those same round
trips cost ~1–5 ms each. Expect tens of milliseconds, not seconds.

What *is* portable is the round-trip **count**: `/api/orders` loads up to 100 orders with three
nested includes, and Prisma fans nested includes into separate sub-queries. Fine at your scale and
colocated; it's the thing that would bite if the database ever moved region.

**To get a real number:** deploy a preview to Vercel and run `autocannon -c 20 -d 10` against it.
That's the only honest way to measure it, and I did not deploy anything.

### 6.2 — Unbounded queries

81 `findMany` calls, 9 with a `take`. Most are naturally bounded (tables in a branch, roles in a
tenant). The ones on tables that grow forever with no limit: `payment` (1), `attendanceRecord` (3),
`expense` (3). At your scale these get slow long before they break. `/api/orders` is correctly capped
at 100.

### 6.3 — One real N+1: the cash-drawer history

`listDrawerDays` (`src/server/cash-drawer.ts`) loops up to 90 days calling `getDrawerDay` per day,
each running several queries — ~90 sequential queries for a default 30-day view. It's a **deliberate**
tradeoff, not an oversight: the comment explains that parallelising would open ~180 connections at
once. Colocated that's roughly 90–450 ms. If that page ever feels sluggish, this is why, and the fix
is one grouped query instead of a loop.

Every other loop-with-await is a write inside a transaction (order lines, payments, role creation at
signup, tenant deletion) — inherently sequential and bounded, not an N+1 read.

### 6.4 — Connection pool sizing

No explicit `connection_limit`. Per warm instance that's Prisma's default pool per client plus
node-postgres's default 10 for the raw pool. Against pgbouncer in transaction mode that's fine at
your scale — it's what transaction pooling is for. Revisit only if you see connection errors.

### 6.5 — WhatsApp and rider phone-login are inert in production

`src/server/whatsapp/adapter.ts` logs instead of sending, so daily summaries, order notifications and
win-back messages all no-op. Rider phone-login is now explicitly disabled in production (§2.2).
Neither is a defect — both are unbuilt integrations — but don't sell either as a live feature yet.

---

## 7. VERIFIED CLEAN (checked, nothing to fix)

- **Secrets:** no hardcoded keys/tokens/credentials in source. `.env*` gitignored and **never**
  committed (`git log --all --full-history -- .env*` is empty). `e2e/.auth/*.json` holds real session
  JWTs and is correctly gitignored and never committed.
- **Passwords:** bcrypt, cost 10, for both passwords and staff PINs. Never plaintext, no MD5/SHA.
- **Session cookies:** no overrides, so NextAuth defaults apply — `httpOnly: true`, `secure` on
  https, `sameSite: lax`.
- **Logout genuinely invalidates the session** — unusual for JWT sessions and worth crediting.
  Sign-out calls `revokeMySessions()` *before* clearing the cookie, deliberately in that order since
  `signOut()` navigates away and a revocation fired after it can be cut short by page unload. Every
  request then re-checks that stamp, plus user-active and tenant-active.
- **Case sensitivity (your Windows → Linux risk):** 916 relative/aliased imports across 319 source
  files checked against git's exact-case filenames. **Zero mismatches, zero unresolved.** All
  `public/` asset references resolve exactly.
- **No hardcoded localhost/ports/absolute paths** in `src/`. **No filesystem writes** — nothing that
  breaks on serverless.
- **SQL injection:** every raw query parameterized. The one `$executeRawUnsafe` interpolates only a
  table name from a frozen hardcoded `as const` array; the tenant id is a bound `$1`.
- **XSS:** zero `dangerouslySetInnerHTML`, zero `innerHTML`, zero `eval` in the entire app.
- **Input validation:** server-side zod schema on every route through the shared handler, regardless
  of what the client sends.
- **Rate limiting:** on every unauthenticated surface — tenant login, staff PIN, platform login, OTP
  request *and* verify, password-reset request *and* confirm, signup, online-order browse/checkout,
  QR checkout, platform MFA re-auth. Postgres-backed, not in-memory, so it works across serverless
  instances.
- **Headers (verified live on the deployed site, not just in config):** CSP with no wildcards, HSTS
  `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `frame-ancestors 'none'`, `object-src 'none'`. `unsafe-eval` correctly dev-only.
- **CORS:** no `Access-Control-Allow-Origin` anywhere — same-origin only.
- **Cron endpoints:** both fail closed (`!env.CRON_SECRET || auth !== Bearer ...` → 401).
- **Privileged routes:** all 13 platform-admin routes go through the platform handler; a tenant
  session cannot reach them, and there's already a test asserting exactly that.
- **File uploads:** tenant-keyed paths, MIME allowlist, size limits (2 MB logos / 5 MB proofs).
  Delivery proofs live in a **private** bucket served via short-lived signed URLs.
- **Database indexes:** 86 declared. Everything that looked un-indexed at block level is covered by a
  field-level `@unique` — including `Subscription.tenantId`, which the per-request tenant gate hits
  on *every authenticated request*, plus `Tenant.slug` and `PlatformUser.email`. No missing index on
  any hot path.
- **Error handling:** the shared handler returns `{ error: "Internal error" }` for anything
  unexpected and reports it to Sentry. `error.tsx` shows an opaque digest, never a stack trace.
- **Logging:** Sentry wired for server, edge and client.
- **No placeholder/lorem text, no TODO/FIXME/HACK, no `debugger`, no focused (`.only`) tests.**
- **Only 3 `console.log`s in the app**, all deliberate dev stubs, all now correctly gated.
- **Build:** compiles clean, zero errors, zero warnings.

---

## 8. ROUTE INVENTORY

124 API routes.

| Category | Count | Tenant scoping |
|---|---|---|
| `defineHandler` (tenant-facing) | 95 | RLS (`app.tenant_id`) **+** automatic `tenantId` injection |
| Platform admin | 13 | Cross-tenant **by design**; separate `platform_user` role + platform session |
| Public / pre-session | 14 | No session by definition — each reviewed below |
| Cron | 2 | Cross-tenant by design; `Authorization: Bearer $CRON_SECRET`, fails closed |

Public routes, and why each is safe to be public: `auth/[...nextauth]`, `auth/request-otp`,
`auth/request-password-reset`, `auth/reset-password` (auth flows, all rate-limited);
`invites/[token]` + `/accept` (the unguessable token *is* the authorization);
`online-order/[tenantSlug]` ×5 (public storefront — tenant resolved from a slug that's public by
design; rate-limited); `signup` (rate-limited 3/hour/IP); `tenants/[slug]/status` (lifecycle status
only for an already-public slug, no PII); `platform/mfa/check` (requires the correct password before
revealing anything, and shares the real login's rate-limit key so it can't be a separate
brute-force channel); `platform/request-password-reset` (rate-limited).

Three `defineHandler` routes declare no permission, all correctly — `account/change-password` and
`hr/clock-out` both act only on `session.id` with no user-supplied identifier, and `signup` was a
false positive in my scanner (matched a code comment; it's a public route).

---

## 9. A NOTE ON THE TEST SUITE

One full-suite run mid-pass reported 5 failures. They were **mine, not the code's**, and I want the
trail on record rather than quietly re-running until green:

- `tenant-isolation` failed at `beforeAll` — the **signup** step, not the isolation assertion. That
  spec's own header documents the interaction: `/api/signup` is rate-limited to 3/hour/IP, and my
  error-leak canary probes had consumed the budget. The isolation assertion never ran.
- That run took 22.7 minutes against a normal ~10.5, indicating the database was still contended
  from my load test.

Re-run cleanly in isolation, all 11 of those tests pass in 3.0 minutes — including the
tenant-isolation assertion actually executing this time. Worth remembering: a red suite here is more
often the shared database or a consumed rate-limit budget than a real regression, and the two look
identical until you read the failure.

---

## RUNNING LOG

- Branched `pre-launch-hardening` from `main` @ `ecc0ceb`.
- Landed two bodies of already-verified work sitting uncommitted (`5e6ba7a`, `31e033c`).
- P1: verified RLS live against the database; audited all 124 routes; found/fixed/proved the payslip
  IDOR (`870a62e`); hardened the storage signed-URL helper (`b197b8b`).
- P2: secrets scan, git-history scan, password/session/rate-limit review, env inventory.
- P3: injection, XSS, validation review.
- P4: case-sensitivity scan (clean), localhost/filesystem scan (clean), production build (clean).
- P5: pooling verified correct for serverless; indexes verified; load test run and its limits
  documented; one real N+1 identified.
- P6: `npm audit fix` (`27afd54`); error-leak review; console.log review; 404 page (`e92c61e`).
- Decisions taken on your instruction: OTP disabled in production (`2401b01`), drift test added
  (`5f759a8`, which found real drift), SVG dropped (`6723498`).
