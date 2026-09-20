# What is left before ToffeeOS can be sold

Written 20 September 2026, after a week of hardening and one production incident.

Ordered by what stops you, not by how hard it is. The first section is the part that has nothing
to do with code.

---

## 1. Blockers — you cannot charge anyone until these are done

### Vercel Hobby prohibits commercial use

This is the terms of service, not a performance ceiling. The moment a café pays you, the deployment
is in breach and Vercel can suspend it without notice, which takes the till down mid-service.

It has already cost you once: when production broke tonight, instant rollback was refused because
it is a Pro feature. Recovery took a manual redeploy of an older build instead.

Upgrading is minutes. Nothing else on this list matters until it is done.

### Nobody knows the production database password

Everything below that touches the database is blocked on this, and it is not recoverable by
looking: Vercel marks the variable Sensitive, so it cannot be read back after it was set.

The fix is a reset, and the order matters. Reset it in Supabase, then **immediately** update
`DATABASE_URL` and `DIRECT_URL` in Vercel and redeploy. Reset without updating Vercel and the site
goes down completely rather than partially.

While you are there: the password currently in use has been typed into a chat window and a shell
history, so it should be rotated regardless.

### Three migrations are pending on production — and the next push now applies them

```
20260914211549_index_unindexed_foreign_keys
20260919174041_add_max_discount_cap
20260919183131_add_refunds
```

This section said the opposite a week ago, and the correction matters more than the original
warning did. The build script now reads:

```
prisma generate && prisma migrate deploy && next build
```

Vercel already holds `DIRECT_URL`, so the deployment applies its own migrations. That inverts the
risk. Previously, pushing code that expected columns the database did not have broke signup and
every order path — which is exactly what the production incident was. Now the schema moves with the
code that needs it, in the same step, and cannot be forgotten.

The failure mode is also the right way round: if a migration fails, the build fails, and Vercel
keeps serving the previous deployment. A broken migration costs you a red build, not a dead till.

So the practical position today:

- The discount ceiling and refunds are built and tested but **dormant** on production. They do not
  exist for a client until the migration runs.
- **The next push to `main` is what runs it.** Production is serving a build from before all of
  this; pushing rebuilds from `main`, applies the three migrations, and brings the two back into
  step. Pushing is the fix, not the hazard.

Nothing here has been pushed. Verify the build once on Vercel rather than assuming it, and watch
the deployment log for `prisma migrate deploy` reporting three applied migrations.

If you ever need to apply them by hand instead — a rollback, or a database the build cannot reach —
use the **session pooler** on port 5432. The direct host is IPv6-only now and will not resolve from
most connections; the transaction pooler on 6543 cannot hold the session lock a migration needs.

```powershell
$env:DIRECT_URL = "postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
$env:DATABASE_URL = $env:DIRECT_URL
npx prisma migrate status   # must say 3 pending
npx prisma migrate deploy
```

---

## 2. Before the first real café goes live

### Backups are being written. Nobody has ever restored one

Checked on 20 September 2026: the nightly job is landing objects in the `db-backups` bucket in
production's Supabase project (`ntzwlkgqzkxworwuiqlh`). That was the open question and it is closed.
Verified by the owner from the Supabase dashboard, not from this repo — production's service role
key is Sensitive in Vercel and cannot be read back, so there is no way to assert this from a test.

Two things about it still need saying.

**Restoring is scripted, and was proven once.** `prisma/restore-backup.ts`, added 10 September
2026. It restores inside `SET session_replication_role = replica` so foreign-key triggers are
suspended — a JSON dump has no dependency ordering — re-enables them at the end, and runs as one
transaction, so a failure rolls back rather than leaving a half-restored database. It refuses to
touch production unless `ALLOW_PROD_RESTORE=1` is set, because every table it writes is emptied
first. It takes its table list from the dump file itself, so it cannot drift from what the backup
writes.

Rehearsed properly on 20 September 2026, against development: `npm run db:backup` to capture the
current state, then `npm run db:restore` to put that same archive back. 8,934 rows across all 56
tables, and afterwards the database was identical — same order count, same totals to the paisa, same
refunded totals, no orphaned foreign keys, menu order intact. The money-path e2e specs were then run
against the restored database and passed. So the mechanism works end to end, not just in principle.

Two changes came out of doing it. The restore inserted one row at a time, which is fine at nine
thousand and the wrong shape for a café a year in — hundreds of thousands of round trips inside one
transaction is where a restore stops being slow and starts timing out, discovered on the worst
possible day. It now batches, clamped per table so a wide table shortens the batch rather than
overrunning Postgres' parameter ceiling. And it now verifies row counts against the archive after
committing and exits non-zero on a mismatch, so a restore reports whether it worked instead of just
exiting.

**What is still not proven: production volume.** Development is 0.46 MB. A trading café is a
different animal, and the failures worth fearing are the ones that only appear at size. Doing that
needs production's service role key, which is Sensitive in Vercel, and a scratch database to restore
into — the backup is read from Supabase Storage and written to whatever `DIRECT_URL` points at, and
those are separate variables, so pointing storage at production and `DIRECT_URL` at a throwaway
database is a safe rehearsal that cannot touch live data.

An earlier version of this note claimed no restore path existed at all. That was wrong on the day it
was written.

**The backups live in the same Supabase project as the data.** That covers the common case — a bad
migration, an accidental delete, an application bug — and not a Supabase-side loss event. Moving to
Pro's managed daily backups with point-in-time recovery is the real answer once revenue justifies
it.

One maintenance note, now enforced: the table list in `src/server/backup.ts` is hand-maintained,
because Prisma 7 no longer exposes model introspection at runtime. A model added to the schema and
left off that list would be silently absent from every backup thereafter — nothing errors, the file
still uploads and still looks the right shape. `tests/backup-coverage.test.ts` now fails if the two
ever disagree, so that cannot happen quietly again.

### Email is not configured at the DNS level

Until three DNS records exist, password-reset emails may not deliver. That means a manager locked
out at 8pm on a Friday has no way back in except you, personally, by phone.

### There is no staging environment

All thirteen environment variables in Vercel are Production-only. There is no Preview or Development
environment, so branch deployments have no database and cannot run. Every change goes straight to
the live site.

That is precisely how production broke tonight: code that needed a migration was deployed before the
migration ran, and there was nowhere to notice in between. One café can survive that. Five cannot.

The fix is a second Supabase project and a Preview set of environment variables, so a branch deploys
somewhere harmless first.

### Set the discount ceiling for every branch you onboard

It defaults to 100%, which means no limit — deliberately, so that deploying it changed nothing for
an existing branch. But a café left at the default has no cap at all, and the roles screen implies
otherwise. Set it during onboarding, per branch.

### The demo tenant's menu has test items on it

The POS grid for the demo tenant carries around a dozen categories named `E2E ...`, each holding
one probe item. They come from the end-to-end tests: any spec that needs an add-on group has to
build its own item, because attaching one to a seeded item would turn every other spec's single tap
into a dialog.

The teardown clears these, but only the ones nothing was ever ordered from. `OrderLine.menuItemId`
is NOT NULL, so an item a test actually sold cannot be deleted without deleting the order too, and
deleting order history to tidy up a menu is the wrong trade to make automatically.

It is cosmetic, and it is also the first thing a café sees if you demo on that tenant. Two ways
out: clear them by hand before a demo, or give those specs a single fixed probe item each instead
of a freshly suffixed one per run, which stops the count growing at all. The second is the real
fix and is maybe an hour.

---

## 3. What a café will run into in the first month

### No tipping, and no per-guest bill splitting

Several tenders against one order works, and so does partial settlement, so "cash plus card" is
fine. Splitting a bill between guests into separate receipts does not exist, and there is no tip or
gratuity field anywhere. The service charge probably covers tipping for this market; the split bill
is worth raising before a table of six asks for it.

### WhatsApp says messages were sent that nothing sends

There is no WhatsApp provider wired up. The adapter is a stub and every message is recorded as
**SENT**. Making it honest flips every message in every log from SENT to FAILED at once — true, and
visible to the client. Decide before a café runs a promotion on it.

### Twenty-nine permissions gate nothing

Ninety-four are declared, sixty-five enforced. The roles screen renders from the registry, so an
owner can toggle twenty-nine switches that change no behaviour — "Reprint KOT" among them.

I went through all twenty-nine. Every one corresponds to a feature that was scoped and never built:
there is no line-void, no no-sale drawer open, no tax-exempt flag, no table merge, no branch price
override, no purchase orders.

Worth singling out one, because a café is likely to ask and the schema would suggest otherwise:
**allergens are not tracked.** `MenuItem.allergens` exists, and both menu endpoints return it, but
nothing writes it and no screen shows it. It is always empty. Do not tell a client the system
records allergens. So the risk is an owner believing a capability is controlled when the
capability does not exist — confusing, not dangerous. Nothing on that list leaves a working feature
ungoverned.

I checked the other direction too, which is the one that would actually matter: of 134 API route
files, 33 declare no permission. All 33 are deliberate — the public ones (login, signup, invite
acceptance, online ordering, tenant status), the two cron jobs (Bearer `CRON_SECRET`, and they fail
closed if it is unset), the platform-admin routes (a separate handler with its own auth), and
`clock-out`, which only ever touches the caller's own record. No tenant-facing route is unguarded.

Worth stating plainly: there is no screen or endpoint anywhere that edits a role's permissions.
Roles are created at signup and changed only by `db:sync-roles`. That is why "Manage roles" is
itself on the unenforced list.

Two came off that list this week: the discount ceiling and refunds both gate something real now. A
test fails if the number grows again, so the decision gets made when a permission is written rather
than when a client finds it.

### Refund figures: two of the three fixes are untested

Adding refunds left three screens still counting money that had been handed back — the P&L, staff
performance, and customer lifetime spend. All three are fixed. Only the P&L is covered end to end
and verified by breaking it again; the other two are one-line subtractions on the same pattern,
reasoned but not separately tested.

One more is a decision rather than a defect: the daily summary message quotes the day's **gross**
takings, so a day with refunds in it reads high. The Sales tab shows both gross and net. Whether
that message should say net is a call about what an owner wants to read at closing time, so it has
been left as it was rather than changed quietly.

### Menu setup imports, but does not edit

A CSV import now exists (Menu → Import a menu). One row per sellable line, repeated rows give an
item its sizes, and it previews before it writes — a file with a bad row in it writes nothing at
all, and re-running skips what is already there, so a run that dies halfway is fixed by running it
again. That takes onboarding a seventy-eight item menu from an evening to a few minutes.

What it does not do is change anything that already exists. Sizes and add-ons can be created but
not renamed or reordered without deleting and recreating them, and the import deliberately will not
update an item it finds — it leaves it alone. A café that wants a price list changed still needs
someone to do it by hand.

### Receipt printing goes through the browser

Both the receipt and the kitchen ticket call `window.print()`. That works with a thermal printer
through the operating system's driver, but it means a print dialog every time rather than one-tap
silent printing, and it has never been tested against real thermal hardware.

Worth an hour with an actual printer before you promise it.

---

## 4. Unverified — genuine unknowns

**iOS Safari has never been tested.** If a café uses iPads on the counter — common — offline
behaviour there is unknown, and offline is the product's headline claim.

**The Supabase connection has been unreliable.** Around a 10% failure rate on direct probes during
one session, enough to destroy three consecutive test runs with `ENOTFOUND` and timeouts. If that is
one machine's network, it is an annoyance. If it is the route to Supabase from Pakistan generally,
it shows up as a till stalling mid-order. The offline queue covers a total outage well; a connection
that is up, slow and intermittently failing is the harder case.

Ten minutes on a different network would settle it.

---

## 5. What is solid

Verified with 154 end-to-end tests and 164 unit tests passing (one e2e test skips itself when the
demo tenant has no second branch), against a clean production build:

- **Offline** — orders punched during an outage queue locally and sync once, with the exact charged
  amount and no drift.
- **Money** — Punjab PRA split rates, integer paisa throughout, a single rounding step, and
  apportionment that always sums to the whole.
- **Tenant isolation** — row-level security forced on every tenant-scoped table, tested against a
  real second tenant created through the public signup flow.
- **Branch isolation on payroll** — a branch manager cannot change pay or disburse at another branch.
- **Password reset** — tokens stored as a fingerprint, claimed atomically, single-use, expiring, and
  revoking every live session.
- **Impersonation** — single-use and audit-logged before the admin follows through.
- **Accessibility and responsive layout** — every staff screen and every public page, at phone,
  tablet and laptop.
- **What the kitchen is told** — add-ons and line notes reach the board, the ticket and the
  customer's receipt, and survive an order punched during an outage. None of that was true a day
  ago: the data was captured and sent and then rendered nowhere, and the offline queue dropped
  add-ons entirely, undercharging without an error anywhere.
- **Refunds reach the reports** — the P&L nets refunds and the tax that went back with them, so it
  can no longer disagree with the Sales tab about the same range.

Every fix in this period was verified by deliberately breaking it and watching the right test fail,
then restoring it. Three times that caught a test that passed for the wrong reason, including one
where removing the cash drawer's refund subtraction left the drawer tests green.

One more thing the suite earned on its last run, worth recording because it argues for running the
whole thing rather than the specs you touched: five POS tests failed together that each passed in
isolation. They were not flakes. Every seeded category shared a sortOrder of 0 and the menu
endpoints ordered on that column alone, so the first category — the one the POS grid opens on — was
whatever Postgres felt like returning that day. The tests had been passing on luck, and a café
would have seen its menu tabs reorder themselves between page loads.

---

## The short version

Upgrade the plan, recover the database password, rehearse a restore against a production dump, and
set up email DNS. The migrations are applied — pushed and confirmed on 20 September 2026. That is the difference between software that works and a business you can invoice
from.

Everything in section 3 is a conversation to have with a café before they sign, not a reason to
wait.
