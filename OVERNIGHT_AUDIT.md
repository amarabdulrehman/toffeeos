# Overnight audit — 15 September 2026

Full pass over the software: every API route, every screen at every size staff use, the money
core, the permission model, accessibility, performance, and what is missing rather than merely
broken.

**Nothing was applied to production, and tonight's commits are not pushed.** Five commits sit on
`main` locally, waiting for you (see *Decisions* below). Everything was tested against the
development database — which, it turns out, is genuinely a different database from production; see
*Corrections*.

---

## Read this first

### 1. A cashier can zero any bill, and the roles screen implies they cannot

This is the most commercially serious thing I found, and it is not a bug — it is a missing
control.

The roles screen offers a permission called **"Exceed maximum discount"**
(`pos.discount.exceedMax`). Denying it looks like it caps how much your staff may take off a bill.
It caps nothing. There is no maximum-discount setting anywhere in the product for it to check
against, so the permission gates no code at all.

I tested it rather than assuming. Signed in as the seeded **cashier**, who does *not* hold that
permission, I put through a Rs 1,000 takeaway order with a 100% order discount. The server
accepted it with HTTP 200 and wrote a **Rs 0** order.

For a restaurant this is the classic theft control — it is how an owner stops staff comping their
friends' meals. Right now anyone who can apply a discount can apply any discount, up to the whole
bill, and the owner has been shown a switch that says otherwise.

I did not invent a cap. Where the limit sits (per role? per branch? a rupee ceiling or a
percentage?) and who may exceed it is your decision, not mine to guess. It needs a settings field,
a check, and a line in the roles UI. **Say the word in the morning and it is a short job.**

### 2. There is no way to reverse a paid order

`pos.payment.refund` exists as a permission string and nowhere else — no route, no schema field, no
code. And a paid order cannot be voided either: `PAID` is one of the terminal statuses, so
`voidOrder` refuses it by design.

Taken together, once money has been taken against an order, **nothing in the software can undo
it.** A wrongly rung-up bill, a returned dish, a double-charge — all of it has to be settled in
cash off-system and reconciled by hand, and the day's reports will disagree with the till.

Most restaurants need this before they need almost anything else on the roadmap. It is a real
feature (refund records, effect on the cash drawer, effect on sales and tax reports), so it is
yours to schedule, not something to bolt on overnight.

### 3. Inventory was silently doing nothing for every new tenant

Recipe stock depletion runs at payment, and the first thing it does is resolve a stock location.
Finding none, it returns an empty result: no deduction, no error, no log line. Signup never created
a stock location — it provisions tax rules, expense categories and roles, but not this — so **every
tenant since launch has started with inventory tracking that quietly does nothing.** An owner could
add their items, write their recipes, sell all week, and find stock had never moved, with nothing
anywhere saying why. Low-stock alerts were dead for the same reason.

The demo tenant had exactly this: zero stock locations, which is how I found it — a test I wrote
failed on the missing fixture rather than on the arithmetic it was checking.

Signup now creates a "Main Store" and sets it as the branch default, and a test fails if it stops.

**Existing tenants are not fixed by this.** They need a location created, once, each. If any
production tenant is using recipes, that is worth doing in the morning — the inventory screen lets
you add one, or it is a one-line insert.

### 4. The database migration is still waiting

`20260914211549_index_unindexed_foreign_keys` — nine foreign keys had no index at all. The one that
matters: **`Order.tableId`**, which the POS uses to resume an open order on every dine-in sitting.
Unindexed, that scans the whole Order table.

Applied to development and verified there. **Production still needs it:**

```bash
npm run db:deploy
```

Deploying code does *not* apply it — `build` runs `prisma generate && next build`, not
`migrate deploy`. Nine `CREATE INDEX` statements on small tables; seconds at your data volume.

### 4. WhatsApp reports messages as sent that nothing sends

Unchanged from my earlier note, and still your call. There is no WhatsApp provider wired up; the
adapter is a stub and `send.ts` records every message as **SENT**. Making it honest flips every
message in every tenant's log from SENT to FAILED at once — true, and visible to clients. That is a
decision, not a side effect I should cause while fixing something else.

---

## Corrections to what I told you earlier

I got two things wrong in the previous report. Both were the same mistake: I measured my laptop and
described production.

### My headline finding was overstated — production was almost certainly never logging reset tokens

I told you *"Production was writing password-reset tokens into its own logs."* I no longer believe
that, and I should not have said it.

The email adapter falls back to `console.log` only when **both** `RESEND_API_KEY` and `EMAIL_FROM`
are unset. Checking Vercel directly: production has had **both set for sixteen days**. So
production has been taking the Resend path, not the stub path, for longer than the bug existed in
the form I described.

Where the claim came from: my local `.env` has `RESEND_API_KEY` but no `EMAIL_FROM`, so *this
machine* takes the stub path. I generalised from that to production without checking, which was
exactly the wrong move on the one finding I led with.

What remains true, and is still worth having fixed: the stub was **ungated**, so it would have
logged live tokens the moment the provider config lapsed — an expired key, a removed variable, a
new environment. It is now gated to non-production and reports to Sentry (subject only) instead of
silently claiming success, and a test pins all three stubs. But it was a latent hole, not an
active leak, and I described it as active.

### Development and production are different databases

I had been treating them as one. They are not, and I can now show it.

Production's public tenant-status endpoint (`/api/tenants/[slug]/status`, a plain lookup with no
status filter) returns `ACTIVE` for the demo tenant `karachi-karahi`, but `null` — the same answer
it gives a made-up slug — for `isolation-test-1789424196510-a1ews8`, a tenant my *local* test run
created a few hours earlier and which is sitting in the development database right now.

Two consequences, one good and one that trims my earlier report:

- **Good:** nothing I ran tonight, all night, touched production data. That is what I wanted to be
  true and had not actually proven.
- **Less good:** every database measurement in my earlier report describes development only. That
  includes the claim that *"production is not cross-region — Supabase is in `ap-southeast-1`,
  co-located with `sin1`"*. That was the development project. Production's database location I have
  not verified, so treat that reassurance as withdrawn rather than confirmed.

### I cannot vouch for production's backups

Following from the above. I found the `db-backups` bucket holding exactly **one** backup, dated
**10 September** — five days stale, with retention set to 14 days, so nothing had pruned it. That
looked alarming.

It is the *development* project's bucket. Production has its own Supabase project, which I have no
credentials for, so **I have not verified that production's nightly backup has ever run.** The cron
is configured (`vercel.json`, 03:30 daily) and `CRON_SECRET` is set in production, which is
necessary but not sufficient — the route fails closed and silently, so a failing job looks exactly
like a working one from outside.

Worth ten minutes in the morning: open the production Supabase project's Storage → `db-backups` and
check the newest object's date. If it is not from the last day or two, the job is failing and the
free-tier backup story is fiction.

---

## Fixed tonight

### Password-reset tokens were stored in usable form

The token was the row's primary key, stored exactly as it was emailed. Every unexpired row in that
table was therefore a working credential for anyone who could read the database — and one kind of
row resets the **platform admin**, which is the super-admin console.

It was not only a breach concern: `backup.ts` dumps all 51 tables, this one included, so every
nightly backup file carried a set of live reset links.

The column now holds a SHA-256 of the token and the lookup hashes whatever the caller presents. **No
migration is needed** — the column is a plain string and only its contents change. Reset links
issued before this stop resolving, which is correct and self-repairing given the 30-minute expiry.

While there, consumption was three unsynchronised statements: read the row, check it was unused,
change the password, then mark it used. Two requests arriving together could both pass the check,
and a failure after the password write left a spent link still usable. The token is now claimed in a
single conditional write and "no row claimed" is the rejection, so the database picks the winner.

### A security test that had never run once

`branch-authorization.spec.ts` covers whether a branch manager can change salaries or disburse
payroll at a branch that is not theirs. It skipped itself when it could not find staff at a second
branch — and the seed creates the second branch without ever staffing it. So that condition was
always true: **the test had never executed a single assertion, in any run, while reporting green.**

It now hires someone at the other branch through the real invite-and-accept flow, runs its
assertions, and deactivates the membership afterwards. The guard it tests turned out to be working
correctly — but nobody knew that, including me.

### The reset flow had no test at all

Nothing exercised the link a locked-out user actually clicks — the one flow in the product that
hands an anonymous caller a working credential. There is now coverage for: the link works, the new
password signs in, the old one stops working, a replay is refused, an expired link is refused, and
the stored value is a digest rather than a token.

### Two tests that failed for the fixture's reasons, not their own

`recipe-costing` assumed the seed left a stock location behind; the demo tenant has none, so it
failed before reaching the arithmetic it exists to check. It now creates what it needs.

The KDS test gave the board 15 seconds to show a sent order — exactly its polling interval, leaving
no room for a first-visit route compile and no chance to catch the next poll. Widened, and its
setup call is now asserted so a failed setup says so.

### The landing page failed its own accessibility check

Nothing tested the pages a stranger sees. Every screen in the responsive and accessibility suites
sat behind a login, so the landing page — the first thing anyone sees of this product — the signup
form, the legal pages and the QR ordering page had no coverage of any kind. The ordering page is
the most phone-critical page you own: it is only ever opened on a phone, by a guest at a table who
did not choose to be there.

Adding them found a real defect on the landing page, `/privacy` and `/terms`: the `--ink-3` token
rendered `#898a96`, which is **3.07:1** on the plan cards and **3.25:1** in the footer, against the
4.5:1 it needs. It is not decoration — it carries the footer navigation, the "Includes" labels in
the plan cards and the folio on the legal pages, so a reader who needs contrast loses the site's
navigation.

Darkened to the first step that clears 4.5:1 on all three grounds it sits on (5.05 / 4.81 / 4.53),
with chroma and hue untouched so it still reads as the same grey — the palette is unchanged in
character. Confirmed in a real browser afterwards: those links now compute `#6d6e79` at 4.81:1.

Good news with it: the landing page does **not** overflow sideways at any size, including 390px.
That is now pinned by a test, and the test was checked by breaking it.

### Impersonation was single-use in intention only

A platform admin's "Impersonate" is the most powerful action in the product: one POST and they are
inside a paying client's live account. It had **no tests at all**, and its single-use token was a
read followed by a delete whose failure was swallowed. Two requests arriving together both read the
row before either deleted it, so one token could open two impersonated sessions; a failed delete
left the token live and the caller carried on anyway.

The token is now claimed with a conditional delete, and only the caller that actually removed a row
proceeds. Coverage added: a tenant session cannot mint a token, minting is audit-logged before the
admin follows through, the token signs in as the owner with the session marked as impersonated, a
replay signs nobody in, and an expired token is refused *and* consumed rather than left behind.

### Carried over from earlier in the audit

| | What was wrong | Why it mattered |
| :--- | :--- | :--- |
| **Ungated dev stubs** | Email/WhatsApp stubs would log payloads in production | Latent account-takeover token in request logs |
| **Back office on a phone** | Sidebar fixed at 240px, no mobile nav | 150px of content at 390px — every management screen unusable |
| **No loading states** | 22 error boundaries, zero loading boundaries | A tap looked like it did nothing until the server answered |
| **Three a11y defects** | Tab labels 4.39:1, POS select unnamed, category pills tinted their own text | Tabs carry navigation on five screens; the select is on the till |
| **Nine unindexed FKs** | Including `Order.tableId` | Table scan on every dine-in order resume |
| **Hidden N+1** | Recipe cost report: one query per ingredient inside `Promise.all` | 100 ingredients = 100 concurrent queries at a bounded pooler |
| **`sumPaisa` unchecked** | Only function in `money.ts` without `assertInt` | Feeds subtotal and tax in the pricing engine |

Every fix above was verified by deliberately breaking it and watching the test fail — including the
three new reset-flow properties and the cross-branch payroll guard. A guard nobody has seen fail is
a guard nobody has tested.

---

## Also worth knowing

**Staff invite tokens have the same shape the reset tokens just lost** — stored in usable form, and
an invite creates an account with a role at a branch. I did not change it, because unlike reset
links the staff screen deliberately re-displays an invite link after creation ("Copy link"), and
hashing would mean the link can only ever be shown once, at the moment it is made. That is a
product trade-off, not a bug fix. Lower risk than the reset tokens were, and worth a decision
rather than a silent change.

**No tips, and no per-guest bill splitting.** Payments already support several tenders against one
order and partial settlement, so "cash plus card" works; what does not exist is splitting a bill
between guests into separate receipts, and there is no tip or gratuity field anywhere in the
schema. The service charge probably covers the second one for this market — worth a moment's
thought rather than an assumption, since it is the sort of thing a client asks for in week one.

**31 permissions gate nothing.** 94 declared, 63 enforced. An owner can toggle 31 switches that
change no behaviour — `pos.discount.exceedMax` above is the costly example, but `pos.payment.refund`
and `orders.markPaid` are the same story. Most correspond to features not built. There is a test
that fails if the number grows, so the decision happens when a permission is written rather than
when a client finds out.

**Conditional skips mean coverage varies run to run.** Seven tests skip themselves on missing data
or a rate limit. That is how the payroll test hid for so long. The rest are benign, but it is worth
knowing that a green run is not always the same green run.

---

## Where the suite stands

**121 end-to-end tests passing, 2 skipped, none failing** (14.6 minutes), plus **127 unit tests**.
The end-to-end suite started the night at 107 tests with one failing; it is now 123, and the
sixteen added are the ones this report is about — the reset flow, impersonation, recipe costing,
the public pages, and tenant provisioning.

Every fix tonight was verified by deliberately breaking it and watching the right test fail, then
restoring it and watching the test pass. That is the only way I trust a guard: one nobody has seen
fail is one nobody has tested. The cross-branch payroll test is the case in point — it had been
"passing" for its whole existence without running.

The two skips are conditional: one waits on a rate-limit window, one on there being enough sales
data. Seven tests can skip themselves this way, which means a green run is not always the same
green run — worth knowing, and it is exactly how the payroll test stayed hidden.

## Checked and clean

No TODO/FIXME anywhere. All 125 API routes guarded or deliberately public, each public one reviewed
individually. Error leakage: every raw-message return is `HttpError`-guarded. Rate limits on every
auth surface. Cron endpoints Bearer-authed and fail closed. No secrets tracked; `.gitignore` covers
`.env*`. `.env.example` documents every declared variable. 55 schema models, none orphaned. Empty
states on every list screen. WhatsApp, Resend and Sentry all degrade safely when unconfigured.

On the development database, all 50 tenant-scoped tables have row-level security enabled *and*
forced. The two that carry no policy — `PasswordResetToken` and `ImpersonationToken` — are denied
to the application's database role outright at the grant level, which is stronger than a policy,
not weaker; they are reached only by the platform role. The backups bucket is private.

---

## Decisions for you

1. **Push tonight's commits?** Five commits are on `main` locally and not pushed. Pushing deploys to
   production. I held off because two of them change authentication paths — reset links issued
   before the deploy stop resolving, which is small and self-healing, but is the sort of thing to
   do while awake rather than at 4am unattended.
2. **`npm run db:deploy`** on production, for the index migration.
3. **Check production's backup bucket** — I cannot see that project.
4. **A maximum-discount control**: do you want one, and where does the limit live?
5. **Refunds**: schedule it?
6. **Stock locations for existing tenants** — new ones are fixed; the ones already there are not.
7. **Invite tokens**: hash them and show the link only once, or keep "Copy link" as it is?
8. **WhatsApp SENT → FAILED**, as above.

## Still yours, unchanged

1. **Vercel Pro** — Hobby prohibits commercial use. Still the real blocker to invoicing anyone.
2. **Email DNS** — three records, then clients recover their own passwords reliably.
3. **Development database password** — still `Amarabdulrehman123`, and it is in the transcript.
   Development only, which I can now say with confidence rather than hope.
4. **Jurisdiction clause** in the Terms, whenever you have a view.
5. **iOS Safari** — still untested. If a client uses iPads, offline behaviour there is unknown.
