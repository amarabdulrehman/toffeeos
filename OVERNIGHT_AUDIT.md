# Overnight audit — 14/15 September 2026

Full pass over the software: every API route, every screen at every size staff use, the money
core, the permission model, accessibility, performance, and what is missing rather than merely
broken.

**Everything below is committed and pushed. Nothing was applied to production.**

---

## Read this first — two things need your decision

### 1. A database migration is waiting

`20260914211549_index_unindexed_foreign_keys` — nine foreign keys had no index at all. The one
that matters: **`Order.tableId`**, which the POS uses to resume an open order on every dine-in
sitting. Unindexed, that scanned the whole Order table.

It is applied to dev and verified. **Production needs `npm run db:deploy`.**

Deploying the code does *not* apply it — `build` runs `prisma generate && next build`, not
`migrate deploy` — so nothing has changed on production. Nine `CREATE INDEX` statements on small
tables; seconds at your current data volume.

```bash
npm run db:deploy
```

### 2. WhatsApp reports messages as sent that nothing sends

There is no WhatsApp provider wired up. The adapter is a stub, and `send.ts` records every message
as **SENT**. Making it honest means every message in every tenant's log flips from SENT to FAILED
at once — true, and visible to clients. That is a decision, not something I should cause as a side
effect of fixing a logging leak, so I left it.

---

## The most serious thing I found

**Production was writing password-reset tokens into its own logs.**

`src/server/email/adapter.ts` falls back to `console.log` when Resend is unconfigured — which is
correct in development, since it is how you read a reset link without a mail provider. It was not
gated, and production is unconfigured.

Both callers put a live reset link in the body. One of them is the **platform admin** reset, whose
token grants the super-admin console. Every reset request wrote that token into Vercel's request
logs, where it persists and is readable by anyone with log access.

It also returned `ok: true`, so nothing knew the mail had never been sent: the user got no email,
no error, and the only trace of their token was the log line.

The WhatsApp stub had the same shape, logging customer phone numbers and message bodies.

Both are gated to non-production now. In production the email adapter reports to Sentry with the
subject only — never the body, never the address — and returns `ok: false`, which is the truth.
No caller branches on the result, so nothing user-facing changed except that a failure is now
visible to us.

The OTP stub had been gated for exactly this reason in an earlier pass. These two were missed,
which is why there is now a test that checks all three.

---

## Fixed

| | What was wrong | Why it mattered |
| :--- | :--- | :--- |
| **Reset tokens in logs** | Email/WhatsApp stubs ungated in production | Account-takeover token in request logs |
| **Back office on a phone** | Sidebar fixed at 240px, no mobile nav | 150px of content at 390px — every management screen unusable |
| **No loading states** | 22 error boundaries, zero loading boundaries | A tap looked like it did nothing until the server answered |
| **Three a11y defects** | Tab labels 4.39:1, POS select unnamed, category pills tinted their own text | Tabs carry navigation on five screens; the select is on the till |
| **Nine unindexed FKs** | Including `Order.tableId` | Table scan on every dine-in order resume |
| **Hidden N+1** | Recipe cost report: one query per ingredient inside `Promise.all` | 100 ingredients = 100 concurrent queries at a bounded pooler |
| **`sumPaisa` unchecked** | Only function in `money.ts` without `assertInt` | Feeds subtotal and tax in the pricing engine |

### New coverage

- **Responsive** — all 17 screens at phone, tablet and laptop, plus the mobile drawer's behaviour
- **Accessibility** — axe over 7 screens, scoped to serious rules, plus focus-visibility on the POS
- **Recipe costing** — had none, and it is money arithmetic owners price from
- **`apportion` invariant** — parts must sum to the whole, across 196 awkward combinations
- **Permission enforcement** — the unenforced count cannot grow silently
- **Log-leak guard** — all three stubs must stay non-production-gated

---

## Worth knowing: 31 permissions gate nothing

94 permissions are declared; 63 are enforced. The roles screen renders from the registry, so an
owner can toggle 31 switches that change no behaviour. Denying "Issue a refund" does not prevent
refunds; denying `staff.roles.manage` does not prevent role editing, which goes through
`staff.manage`.

Most correspond to features not built yet. Deciding which to wire up, hide, or delete is yours —
I did not guess. What I did add is a test that fails if the number grows, so the decision happens
when a permission is written rather than when a client finds out.

---

## Checked and clean

No TODO/FIXME anywhere. All 125 API routes guarded or deliberately public, each public one
reviewed individually. Error leakage: every raw-message return is `HttpError`-guarded. Rate limits
on every auth surface. Cron endpoints Bearer-authed and fail closed. No secrets tracked;
`.gitignore` covers `.env*`. `.env.example` documents every declared variable. 55 schema models,
none orphaned. Empty states on every list screen. WhatsApp, Resend and Sentry all degrade safely
when unconfigured.

---

## Corrections to things I told you earlier

**Production is not cross-region.** `vercel.json` pins functions to `sin1`; Supabase is in
`ap-southeast-1`. They are co-located. The 6.3s I measured on `POST /api/orders` was this laptop
reaching Singapore, not production latency. My earlier warning about that was unfounded.

**My first responsive test was wrong and passed a sabotage.** It measured only
`document.scrollWidth`, but the shell puts `overflow-auto` on `<main>` — so the document stays
exactly 100% wide while a page is visibly broken. Correcting it is what surfaced the 150px content
area, which the original test would never have found.

**My first index query was wrong too.** It asked which foreign keys are not the *leading* column
of an index and reported eighteen. That is the standard check and it is wrong for a multi-tenant
schema, where `[tenantId, x]` is the correct shape. Asking which columns appear in no index at all
gave nine.

---

## Still yours, unchanged

1. **Vercel Pro** — Hobby prohibits commercial use. Still the real blocker to invoicing anyone.
2. **Email DNS** — three records, then clients recover their own passwords *and* the adapter stops
   reporting failures.
3. **Dev database password** — still `Amarabdulrehman123`, and it is in the transcript.
4. **Jurisdiction clause** in the Terms, whenever you have a view.
5. **iOS Safari** — still untested. If a client uses iPads, offline behaviour there is unknown.
