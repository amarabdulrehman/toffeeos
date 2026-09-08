# ToffeeOS — Pre-Launch Hardening Report

**Branch:** `pre-launch-hardening` — never pushed, nothing deployed.
**Base:** `main` @ `ecc0ceb`
**Run date:** 2026-09-09

---

## 1. GO / NO-GO VERDICT

**Conditional GO — but not before you read §2, and one item there is a hard blocker.**

Tenant isolation, which is the thing you said matters most, is genuinely well built. It is not
"filtered in the frontend" — it is enforced in Postgres itself. 53 of 56 tables have row-level
security **enabled and forced**, the runtime database role (`app_user`) has `rolbypassrls = false`
(verified directly against the live database, not assumed), and every one of the 95 tenant-facing
API routes goes through a single choke point that sets the RLS tenant variable *and* independently
injects a `tenantId` filter. Two independent layers. I tried to find a cross-tenant hole and could
not, and the existing test suite already attacks this properly — it signs up a real second tenant
through the public flow and attacks the first with real IDs, rather than fabricated ones.

I did find one real data-exposure bug, but it was **cross-branch, not cross-tenant**: any Branch
Manager could read any employee's salary at any other branch of the same restaurant. That is fixed
and proven fixed. No client could ever see another client's data through it.

The blocker is not isolation. It is that **rider OTP login codes are written to your production
server logs in plaintext**, and that is also the only way a rider can currently receive one — which
means rider login is simultaneously insecure and non-functional in production. That needs your
decision tonight, because the fix and the feature are the same conversation (§4.1).

Everything else I found is either fixed, or a limitation you should know about rather than a reason
to delay. If you resolve §4.1 — even by just disabling rider login for launch — I would ship this.

---

## 2. CRITICAL

### 2.1 — FIXED: Cross-branch salary leak (IDOR) — `commit 870a62e`

`GET /api/hr/payslip/[membershipId]` took the membership id straight from the URL and passed it to
`getPayslip`, which scopes by tenant (RLS) but **not by branch**. A Branch Manager could read any
employee's pay type, hourly rate, monthly salary, hours worked and gross pay at any other branch in
the same restaurant by changing one id in the URL.

This was not theoretical. With the guard removed, the seeded Branch Manager gets `200` and:

```json
{"userName":"Other Branch Employee","branchName":"DHA Phase 6",
 "monthlySalaryPaisa":9999900,"grossPayPaisa":9999900, ...}
```

Root cause is informative: an earlier hardening pass fixed exactly this bug class on the HR **write**
routes (`pay-profiles` PATCH, `payroll/disburse`) using an `assertWritableMembership` helper, and
missed this one **read**. It was the only HR route accepting a membership or branch identifier
without checking it.

Fixed with that same helper. New spec `e2e/payslip-branch-isolation.spec.ts` asserts the 403 *and*
that the salary figure appears nowhere in the response body, plus two positive controls (manager
reading their own branch; owner reading across branches). Both controls still pass with the guard
removed, which is what proves the failing assertion is specifically the branch check.

### 2.2 — NEEDS YOUR DECISION: OTP login codes written to production logs

`src/server/auth/otp-store.ts:20` runs unconditionally, in every environment:

```ts
console.log(`[OTP STUB] ${key} -> ${code} (expires in 5 min)`);
```

`key` is the rider's phone number, `code` is their live login OTP. On Vercel this lands in your
function logs in plaintext. Anyone with log access — you, anyone you add to the Vercel project, or
any log drain you connect later — can read a valid OTP inside its 5-minute window and log in as that
rider. It is also a PII leak (phone numbers).

**I did not fix this, deliberately**, because it is not only a security bug: there is no SMS or
WhatsApp sender wired up, so this log line is currently *the only way an OTP reaches anybody*.
Deleting it closes the leak and simultaneously makes rider login completely unusable. That is a
product call, not a code call. See §4.1 for the three options.

---

## 3. FIXED

| # | What | Commit |
|---|---|---|
| 1 | Cash-drawer day could never be corrected after a typo — now correctable by Owner/Branch Manager only, fully audit-logged, original closer preserved | `5e6ba7a` |
| 2 | Two public endpoints returned internal error text to anonymous callers | `31e033c` |
| 3 | Cross-branch salary leak on the payslip route (§2.1) | `870a62e` |
| 4 | Delivery-proof signed-URL helper accepted any storage path | `b197b8b` |
| 5 | Two dependency advisories patched without a breaking upgrade | `27afd54` |

**On #2** — `POST /api/signup` and `POST /api/invites/[token]/accept` both ended with
`err instanceof Error ? err.message : "..."` and returned that to the caller. Both are
unauthenticated. Verified by planting an internal error and calling the endpoint with a schema-valid
body; it came back in full:

```
{"error":"LEAKCANARY-P2002 Unique constraint failed on User.passwordHash at /var/task/src/server"}
```

A real Prisma failure would have handed an anonymous caller the model, constraint, columns and a
server path. There was also a real one already reachable: `The <plan> plan is not seeded — run
npm run seed first.` Both routes now forward only deliberate `HttpError` messages and send anything
else to Sentry. Worth noting: my *first* attempt at this test was itself masked — an incomplete body
was rejected by the zod schema before the handler ever ran, which looks like a pass and proves
nothing.

**On #4** — `resolveProofUrl` minted a signed URL for any path handed to it, using the service-role
key, which ignores RLS entirely. It is currently unreferenced, so this was a latent footgun rather
than a live hole; it now refuses paths outside the caller's own tenant prefix.

---

## 4. NEEDS MY DECISION

### 4.1 — Rider OTP login: insecure *and* non-functional (see §2.2)

Three options, in the order I'd pick them:

1. **Disable rider OTP login for launch.** Cleanest. Riders get accounts via the normal staff flow.
   Removes a whole unauthenticated attack surface from day one.
2. **Wire a real sender** (Twilio / WhatsApp Business API) and delete the log line. This is what the
   feature was always waiting on. Not an overnight job.
3. **Gate the log to non-production** (`if (env.NODE_ENV !== "production")`). One line, stops the
   leak — but rider login then silently does nothing in production, which is worse than option 1
   because it looks like it works.

I can do (1) or (3) in a few minutes on your word. I did not pick one because all three change what
riders can do.

### 4.2 — `Tenant` table is outside both isolation layers

`Tenant` has no RLS (it *is* the tenant registry, so a tenant-scoped policy is circular) and is
deliberately excluded from the auto-injection allowlist. Both current call sites scope it correctly
by hand (`where: { id: session.tenantId }`), so there is no bug today. But it is the one table where
a future forgotten `where` clause returns or modifies *other restaurants' rows* silently, with no
safety net beneath it. Adding RLS here would break login, which must read tenants cross-tenant
before any session exists. Worth knowing; I would not change it tonight.

### 4.3 — `TENANT_SCOPED_MODELS` is hand-maintained with no drift test

`src/server/db.ts` keeps a hand-written list of every tenant-scoped model, with a comment saying to
keep it in sync with the RLS migration and the schema. Nothing enforces that. Add a model with a
`tenantId`, forget the list, and queries on it run unscoped. RLS would still catch it (fail closed,
zero rows) *provided* the RLS migration was updated — so it takes two misses, not one. The codebase
already pins the equivalent list for tenant deletion with a test that fails on drift; this one
deserves the same. Additive test only, no behavior change — say the word and I'll add it.

### 4.4 — No custom 404 page

`error.tsx` and `global-error.tsx` exist and are intentional. There is no `not-found.tsx`, so 404s
get Next.js's default. You asked me to confirm these exist — this one doesn't. I did not add it
because you told me not to change UI, and "looks intentional" is a design decision.

### 4.5 — SVG allowed for tenant logos, in a public bucket

`ALLOWED_LOGO_TYPES` includes `image/svg+xml` and the logo bucket is public. SVGs can carry scripts.
They render on the Supabase storage origin, not yours, so they cannot touch your users' sessions —
the practical risk is low. Dropping SVG is a one-line change but would reject a format a client may
already have uploaded, so it's your call.

### 4.6 — Two dependency advisories left unfixed, on purpose

`mysql2` (high) reached only via the `prisma` CLI. Both advisories require speaking the MySQL wire
protocol to a hostile server; this app is Postgres-only through `@prisma/adapter-pg` and never loads
that driver. The only offered fix is `npm audit fix --force`, which downgrades Prisma 7.10 → 6.19 —
a major version that removes the driver-adapter API this codebase is built on. Not worth it for an
unreachable advisory.

---

## 5. ENV VARS CHECKLIST

From `src/lib/env.ts`, which validates all of these at boot (not at import — deliberately, so builds
don't need runtime secrets).

**Required — the app will refuse to start without these:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Must be the **pooler, port 6543, `?pgbouncer=true`**. Verified correct locally. |
| `DIRECT_URL` | Direct connection, port 5432. Migrations only. |
| `PLATFORM_DATABASE_URL` | `platform_user` role (BYPASSRLS by design). Pooler, 6543. |
| `NEXT_PUBLIC_SUPABASE_URL` | Also feeds the CSP `connect-src` / `img-src` allowlist at build time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage uploads + signed URLs. Ignores RLS — server-side only. |
| `AUTH_SECRET` | JWT signing. |
| `NEXT_PUBLIC_APP_URL` | Must be the real production URL — used in password-reset email links. |

**Optional but you almost certainly want them set:**

| Variable | If unset |
|---|---|
| `AUTH_URL` | Defaults from the request; set it to the production URL to be safe. |
| `CRON_SECRET` | **Both cron endpoints reject every request.** Daily summaries and backups silently stop. |
| `RESEND_API_KEY` | Password-reset emails are `console.log`ged instead of sent. |
| `EMAIL_FROM` | Same. Currently the Resend sandbox sender — only delivers to your own address until you verify a domain. |
| `SENTRY_DSN` | No error reporting. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Source-map upload skipped (build warning only). |

`NODE_ENV` is set by Vercel; don't set it yourself.

---

## 6. KNOWN LIMITATIONS

### 6.1 — Load test numbers, and why they don't predict production

Against a local production build, 20 concurrent users:

| Endpoint | p50 | p99 | Throughput | Errors |
|---|---|---|---|---|
| `/login` (SSR page) | 29 ms | 52 ms | ~500 req/s | 0 |
| `/api/orders` (DB-backed) | 7,537 ms | 9,884 ms | 1.9 req/s | 1 timeout |

**Do not read the second row as a production forecast.** My machine talks to your Supabase instance
in `ap-southeast-1` across the internet — the codebase's own measurements put that at 150–250 ms
*per round trip*. An uncontended single request measured ~1.5 s, which is roughly 6–10 sequential
round trips. In production, `vercel.json` pins `sin1` and the database is in `ap-southeast-1` —
colocated — so those same round trips cost ~1–5 ms each. Expect roughly 10–40 ms, not 7.5 s.

What *is* portable: the round-trip **count** per request. `/api/orders` loads up to 100 orders with
three nested includes, and Prisma fans nested includes out into separate sub-queries. That's fine at
your scale and colocated, but it's the thing that would bite you if the DB ever moved region.

**I could not produce a production-representative number from this machine.** To get a real one:
deploy a preview to Vercel and run the same `autocannon -c 20 -d 10` against it. That's the only way
to measure it honestly, and I did not deploy anything.

### 6.2 — Unbounded queries

81 `findMany` calls, 9 with a `take`. Most are naturally bounded (tables in a branch, roles in a
tenant). The ones on tables that grow forever and have no limit: `payment` (1), `attendanceRecord`
(3), `expense` (3). At single-digit-to-low-tens of users these are fine for a long time; they become
slow first, not broken. `/api/orders` is correctly capped at 100.

### 6.3 — Connection pool sizing

No explicit `connection_limit`. Per warm instance that's roughly Prisma's default pool per client
plus node-postgres's default 10 for the raw pool. Against pgbouncer in transaction mode this is fine
at your scale — it's the reason transaction pooling exists. Worth revisiting only if you see
connection errors under real traffic.

### 6.4 — WhatsApp is a stub

`src/server/whatsapp/adapter.ts` logs instead of sending. Daily summaries, order notifications and
win-back messages all no-op in production. Known and intentional; noted here so it isn't a surprise
on day one.

---

## VERIFIED CLEAN (checked, nothing to fix)

- **Secrets:** no hardcoded keys/tokens/credentials in source. `.env*` gitignored and **never**
  committed (`git log --all --full-history -- .env*` is empty). `e2e/.auth/*.json` holds real
  session JWTs and is correctly gitignored and never committed.
- **Passwords:** bcrypt, cost 10, for both passwords and staff PINs. Never plaintext, no MD5/SHA.
- **Case sensitivity (your Windows → Linux risk):** 916 relative/aliased imports across 319 source
  files checked against git's exact-case filenames. **Zero mismatches, zero unresolved.** All
  `public/` asset references resolve exactly.
- **No hardcoded localhost/ports/absolute paths** in `src/`. **No filesystem writes** — nothing that
  breaks on serverless.
- **SQL injection:** every raw query is parameterized. The one `$executeRawUnsafe` interpolates only
  a table name from a frozen hardcoded `as const` array (tenant deletion); the tenant id is a bound
  `$1` parameter.
- **XSS:** zero `dangerouslySetInnerHTML`, zero `innerHTML`, zero `eval` in the entire app.
- **Input validation:** server-side zod schema on every route through the shared handler; validation
  runs server-side regardless of what the client sends.
- **Rate limiting:** present on every unauthenticated surface — tenant login, staff PIN, platform
  login, OTP request *and* verify, password-reset request *and* confirm, signup, online-order
  browse/checkout, QR checkout, platform MFA re-auth. Postgres-backed, not in-memory, so it actually
  works across serverless instances.
- **Headers (verified live on the deployed site, not just in config):** CSP with no wildcards, HSTS
  `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`, `object-src 'none'`. `unsafe-eval` is
  correctly dev-only.
- **CORS:** no `Access-Control-Allow-Origin` anywhere — same-origin only. Correct for this app.
- **Cron endpoints:** both fail closed (`!env.CRON_SECRET || auth !== Bearer ...` → 401).
- **Privileged routes:** all 13 platform-admin routes go through the platform handler; a tenant
  session cannot reach them (there's already a test asserting exactly that).
- **File uploads:** tenant-keyed paths, MIME allowlist, size limits (2 MB logos / 5 MB proofs).
  Delivery proofs are in a **private** bucket served via short-lived signed URLs.
- **Error handling:** the shared handler returns `{ error: "Internal error" }` for anything
  unexpected and reports it to Sentry — no stack traces, schema or paths to clients.
- **Logging:** Sentry wired for server, edge and client.
- **Build:** compiles clean, zero errors, zero warnings.
- **Only 3 `console.log`s in the app**, all deliberate dev stubs. Two are correctly gated behind
  "is the real sender configured". The third is §2.2.

---

## ROUTE INVENTORY

124 API routes total.

| Category | Count | Tenant scoping |
|---|---|---|
| `defineHandler` (tenant-facing) | 95 | RLS (`app.tenant_id`) **+** automatic `tenantId` injection |
| Platform admin | 13 | Cross-tenant **by design**; separate `platform_user` role + platform session |
| Public / pre-session | 14 | No session by definition — each individually reviewed below |
| Cron | 2 | Cross-tenant by design; `Authorization: Bearer $CRON_SECRET`, fails closed |

Public routes and why each is safe to be public: `auth/[...nextauth]`, `auth/request-otp`,
`auth/request-password-reset`, `auth/reset-password` (auth flows, all rate-limited);
`invites/[token]` + `/accept` (the unguessable token *is* the authorization);
`online-order/[tenantSlug]` ×5 (the public storefront — tenant resolved from the URL slug, which is
public by design; rate-limited); `signup` (creates a tenant; rate-limited 3/hour/IP);
`tenants/[slug]/status` (returns only lifecycle status for an already-public slug — no PII);
`platform/mfa/check` (requires the correct password before revealing anything, and shares the real
login's rate-limit key so it can't be used as a separate brute-force channel);
`platform/request-password-reset` (rate-limited).

Three `defineHandler` routes declare no permission, all correctly: `account/change-password` and
`hr/clock-out` (you acting on yourself), and `signup` (matched by my scanner on a code comment — it's
actually a public route, listed above).

---

## RUNNING LOG

- Branched `pre-launch-hardening` from `main` @ `ecc0ceb`.
- Landed two bodies of already-verified work that were sitting uncommitted (`5e6ba7a`, `31e033c`).
- P1: verified RLS live against the database; audited all 124 routes; found, fixed and proved the
  payslip IDOR (`870a62e`); hardened the storage signed-URL helper (`b197b8b`).
- P2: secrets scan, git-history scan, password/session/rate-limit review, env var inventory.
- P3: injection, XSS, validation review.
- P4: case-sensitivity scan (clean), localhost/filesystem scan (clean), production build (clean).
- P5: pooling verified correct for serverless; load test run and its limitations documented.
- P6: `npm audit fix` applied (`27afd54`); error-leak review; console.log review.
- Full e2e regression run at end of pass.
