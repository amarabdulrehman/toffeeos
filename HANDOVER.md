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

The fix is a reset, and it is safer than an earlier version of this note said — but only if you
touch **one** variable, not two.

The app connects to Postgres as three different roles, and only one of them is `postgres`:

| Variable | Role | Used for |
|---|---|---|
| `DATABASE_URL` | `app_user` | every tenant query, with row-level security enforced |
| `PLATFORM_DATABASE_URL` | `platform_user` | the platform admin console, BYPASSRLS |
| `DIRECT_URL` | `postgres` | migrations during a deploy, and local admin scripts |

Supabase's "reset database password" changes the `postgres` password and nothing else. `app_user`
and `platform_user` have their own passwords, set by hand when the roles were created. So:

1. Reset the password in Supabase.
2. Update **only `DIRECT_URL`** in Vercel:
   `postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
3. Redeploy.

**Do not change `DATABASE_URL` or `PLATFORM_DATABASE_URL`.** An earlier version of this note told
you to point `DATABASE_URL` at `postgres`. That would have been a quiet disaster: `postgres` is a
superuser, and superusers ignore row-level security entirely. Everything would have kept working —
nothing would look wrong — while the database-level wall between one café's data and another's was
gone.

Nothing live uses `postgres`, so the reset cannot take the till down, and it is safe during
trading. The only thing it can break is the next deploy's migration step, which fails the build and
leaves the current deployment serving until `DIRECT_URL` is updated.

If the password contains `@ # / ?`, percent-encode those characters in the URL (`@` is `%40`).

While you are there: the password currently in use has been typed into a chat window and a shell
history, so it should be rotated regardless.

### Two migrations are pending on production — and the next push applies them

```
20260924212601_lowercase_login_identifiers
20260924223305_business_day_start
```

The three from the week before (index foreign keys, discount cap, refunds) were pushed and confirmed
on 20 September 2026. These two came with the tablet, bill and Daily Sales work and have run only
against development.

The build script runs `prisma migrate deploy` before `next build`, so the deployment applies its own
migrations: the schema moves with the code that needs it. If a migration fails, the build fails and
Vercel keeps serving the previous deployment — a red build, not a dead till.

**One of the two can refuse on purpose.** `lowercase_login_identifiers` stores every email and
restaurant code in lowercase, because sign-in now ignores capitals. If two staff in one restaurant
have emails that differ only by capitals (`Ali@x.com` and `ali@x.com`), they would become the same
login, and there is no safe way to pick one. So the migration stops with a message naming how many
clashes there are, instead of guessing. Development has none. If production does, the build goes
red and nothing changes until someone renames one of the pair.

Watch the deployment log for `prisma migrate deploy` reporting two applied migrations.

If you ever need to apply them by hand instead — a rollback, or a database the build cannot reach —
use the **session pooler** on port 5432. The direct host is IPv6-only now and will not resolve from
most connections; the transaction pooler on 6543 cannot hold the session lock a migration needs.

```powershell
$env:DIRECT_URL = "postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
$env:DATABASE_URL = $env:DIRECT_URL
npx prisma migrate status   # must say 2 pending
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

### The demo tenant's menu is clean

The end-to-end tests have to build their own menu items, and each run used to leave a few
`E2E ...` categories on the demo tenant — around a hundred by now, and the first thing a café would
see on the POS grid in a demo. Teardown now deletes the ones nothing was ever ordered from and
switches off the rest. Categories holding an item that was actually sold cannot be deleted without
deleting the order, but the menu, the POS and the storefront all read active categories only, so
they disappear while every order that references them stays intact.

One stays visible on purpose: `E2E Options`, which `menu-options.spec.ts` reuses across runs. It
is a single category, and hiding it would make that spec create a fresh one every run.

### No tipping, and no per-guest bill splitting

Several tenders against one order works, and so does partial settlement, so "cash plus card" is
fine. Splitting a bill between guests into separate receipts does not exist, and there is no tip or
gratuity field anywhere. The service charge probably covers tipping for this market; the split bill
is worth raising before a table of six asks for it.

### WhatsApp is built and honest, and waiting on Meta

The software side is finished. What is left is account work, not code.

The adapter is a real Cloud API client now. It sends `type: "template"` with the registered
template name and its parameters in order, which is what Meta requires — business-initiated
messages (a daily summary, a win-back, a low-stock alert) cannot be free text, they can only be
approved templates. It carries its own 8-second timeout and catches everything, because
`notifyOrderThankYou` runs inside the payment path and an uncaught error or a hung request there
would fail or stall a sale over a thank-you message.

It no longer lies. With no credentials nothing is attempted and the message is logged
`SKIPPED_NOT_CONFIGURED` with the reason attached, rather than the old stub's **SENT**. That was
the worst state available: an owner reading a month of delivered-looking messages that had never
left the building. The WhatsApp screen now says plainly whether this deployment can send, and the
message log shows why anything failed.

The history is corrected too. Every row the old stub wrote as SENT had no Meta message id, because
nothing was ever sent; a migration rewrites exactly those to `SKIPPED_NOT_CONFIGURED` with an
explanation, and cannot touch a genuine delivery, which always carries one.

**What you still have to do, and none of it is in this repo:**

1. Meta Business account and business verification — days to weeks, and entirely out of your hands
2. A WhatsApp Business Account and a phone number not already registered on WhatsApp
3. Submit each template to **Meta** for approval. The approve/reject flow on the Templates tab is
   ours, for your own review — it is not Meta's, and Meta rejects on tone and formatting
4. Set `WHATSAPP_ACCESS_TOKEN` in Vercel (a permanent System User token, one for the platform)
5. Paste each restaurant's phone number ID into WhatsApp → Connection

The token is platform-level and the phone number ID is per tenant, so one Meta app serves every
café. If a template was registered under a different name than its key, put that in
`WhatsAppTemplate.metaTemplateName`; otherwise the key is used and already matches Meta's format.

The send path is covered by `tests/whatsapp-adapter.test.ts`, which controls `fetch` to pin the
payload shape, the timeout, Meta's rejections, non-JSON responses and the access token never
reaching a tenant-readable log. `e2e/whatsapp-connection.spec.ts` pins the honest logging. What
nobody can test until step 4 is a real delivery.

### Twenty-seven permissions gate nothing

Ninety-four are declared, sixty-seven enforced. The roles screen renders from the registry, so an
owner can toggle twenty-seven switches that change no behaviour. "Reprint KOT" used to be among
them and no longer is: printing a kitchen ticket from the till now gates on `pos.kot.print`, and
reprinting one from the Order Queue on `pos.kot.reprint`. "Print receipt" came off too: it now
decides who can print a bill for a table before it pays, which the seeded Waiter role cannot.

I went through the rest. Every one corresponds to a feature that was scoped and never built:
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

**iPads are tested in emulation, not on a real device.** The suite now runs the till, kitchen
tickets, offline mode, the kitchen screen and the customer storefront a second time as an iPad in
landscape — WebKit, which every iPad browser uses underneath, Chrome included — and all of it
passes, offline sync included. That covers the engine and the layout. It does not cover iOS itself:
the on-screen keyboard covering an input, the print dialog, Safari suspending a backgrounded tab
mid-order. Ten minutes on the café's actual iPad before their first service is still worth it.

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
- **Daily Sales** — today, yesterday, any day, and weekly and monthly closings with every day
  listed and a printable summary. Built on the Sales report's own definition of a sale, and tested
  to agree with it to the paisa for a day and for a week. Owners and managers only.
- **A café's day can end after midnight** — each branch sets when its day ends (midnight to 6am, on
  the Branches screen). A 1:30am sale then counts in tonight's takings, drawer and closing, and the
  Sales report, cash drawer, dashboard and WhatsApp summary all follow the same setting.
- **A bill before payment** — priced once per way of paying, so a PRA branch prints the cash and the
  card total, each exactly what payment then charges. The kitchen ticket is unchanged.
- **Sign-in ignores capitals and stray spaces** in the email and restaurant code.
- **The till on tablets and phones** — the menu and the order sit side by side on a tablet; on a
  phone the order opens as a sheet from a bar at the bottom.

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
set up email DNS. The next push applies two migrations; watch that build go green (section 1). That is the
difference between software that works and a business you can invoice from.

Everything in section 3 is a conversation to have with a café before they sign, not a reason to
wait.
