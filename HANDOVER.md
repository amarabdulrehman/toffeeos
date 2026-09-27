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

### Migrations: three waiting for the next push

```
20260925093913_till_actions
20260925101500_role_defaults_for_till_actions
20260925120000_purchasing_loyalty_online
```

Everything before them is on production (confirmed from the build log of 25 September 2026). These
three come with the till and back-office work and have run only against development. The third
does two things beyond adding tables, both deliberate:

- It puts any delivery order that was **paid and then delivered** back to PAID. Marking an order
  delivered used to overwrite PAID with DELIVERED, which took it out of every sales figure. A
  delivered order with no payment stays DELIVERED — cash on delivery still to be handed in — and the
  Delivery screen now lists those with a "Cash received" button.
- It removes six retired permission keys from every role (see "Every permission" below).

The build script runs `prisma migrate deploy` before `next build`, so each push applies its own
migrations: the schema moves with the code that needs it. If a migration fails, the build fails and
Vercel keeps serving the previous deployment — a red build, not a dead till.

If you ever need to apply one by hand — a rollback, or a database the build cannot reach — use the
**session pooler** on port 5432. The direct host is IPv6-only now and will not resolve from most
connections; the transaction pooler on 6543 cannot hold the session lock a migration needs.

```powershell
$env:DIRECT_URL = "postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
$env:DATABASE_URL = $env:DIRECT_URL
npx prisma migrate status
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

### Nobody is told when the site goes down

`https://toffeeos.com/api/health` answers 200 when the app is serving and the database responds,
and 503 when the database does not. Point a free monitor at it — UptimeRobot, Better Stack or
cron-job.org, checking every five minutes — with your phone number for alerts. It needs an account
only you can create, and it is ten minutes' work. Until then, the first you hear of an outage is a
café calling.

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

### Every permission on the roles screen does something

Eighty-eight are declared and all eighty-eight gate something; a test fails if a new one is added
without. It was twenty-seven switches that did nothing at the start of 25 September 2026. Each was
either built or retired:

- **Built** — voiding one item, switching dine-in and takeaway, merging tables, tax-exempt orders,
  no-sale drawer openings, kitchen recall (the till); purchase orders and suppliers, transfer
  approval, undoing a stock adjustment, low-stock alert levels (inventory); per-branch menu prices;
  the role editor; loyalty points; an online-menu switch per dish and table QR codes; service
  charge and report downloads as their own permissions; Plan & billing (plan, status and payment
  dates only — no prices or amounts, by the owner's decision, since rates are agreed directly);
  and "mark paid" for the rider's cash on a cash-on-delivery order.
- **Retired**, never having gated anything and with nothing sensible to gate — hand-editing tax,
  bypassing PIN and shift-time checks that don't exist, allergens (declined), a duplicate "profit"
  view, and self-service plan changes. Migration `20260925120000` took them off every role.

**Roles can now be edited** (Staff → Roles and what they can do), and a person's role changed from
the staff list. The Owner role is locked — it always has everything, this screen included. Editing
a standard role makes it the owner's own, so `db:sync-roles` will never overwrite it. A change
applies at each person's next sign-in, or at once if the owner ticks "sign everyone in this role
out"; changing one person's role always signs them out, so it applies immediately.

**Allergens are still not tracked.** `MenuItem.allergens` exists, and both menu endpoints return it,
but nothing writes it and no screen shows it. Do not tell a client the system records allergens.

I checked the other direction too: every API route either declares a permission or is deliberately
public — login, signup, invite acceptance, online ordering, tenant status, the health check, the
two cron jobs (Bearer `CRON_SECRET`, failing closed if unset), the platform-admin routes (their own
handler and auth), and `clock-out`, which only touches the caller's own record.

### Refunds reach every figure

Adding refunds left three screens still counting money that had been handed back — the P&L, staff
performance, and customer lifetime spend. All three are fixed and each has its own end-to-end test
(`e2e/pnl.spec.ts`, `e2e/refund-consequences.spec.ts`). The WhatsApp daily summary now quotes net
sales too, naming the refund when there was one, so it matches Daily Sales.

### Menu import updates prices, and never deletes

A CSV import exists (Menu → Import a menu). One row per sellable line, repeated rows give an item
its sizes, and it previews before it writes — a file with a bad row in it writes nothing at all.
That takes onboarding a seventy-eight item menu from an evening to a few minutes.

Re-importing brings an updated price list in: a changed price, size price or description updates
the item, and a new size is added. Nothing missing from the file is ever deleted. An item with sizes
on the menu but a single price in the file is left alone and the preview says why, since whether
that means "drop the sizes" or "the file is incomplete" is the owner's call.

Sizes and add-ons can be created but not renamed or reordered on the Menu screen without deleting
and recreating them.

### Receipt printing goes through the browser

Every ticket — receipt, bill, kitchen ticket, closing summary, no-sale slip — prints through the
browser and the operating system's printer driver. That means a print dialog each time rather than
one-tap silent printing.

**The printer kept feeding paper after every ticket — fixed 27 September 2026, second attempt.**
The first fix (26 September) declared a page exactly the ticket's size (`@page { size: 80mm Hmm }`)
and its tests checked that the rule was declared. On the owner's real printer (a Black Copper 80,
from Chrome) it made no difference, and the owner's photo of the print window showed why: Chrome
prints on the paper selected for the printer whatever the page declares. It centred the declared
page on that paper and printed its own header and footer (date, title, web address, page number) on
the paper's edges — so on a receipt printer's usual paper, a roll "page" about 3.3 metres long, the
footer sat 3.3 metres down and the printer fed blank paper all the way there. A short kitchen ticket
also declared a page wider than long, which Chrome sends as landscape: it printed sideways.

Now `src/lib/print-ticket.ts` declares `@page { size: portrait; margin: 0; }`: the page is the
printer's paper, the ticket at its top, no margins for a header or footer, never landscape. It still
prints the ticket alone (everything else display: none) at the device's paper width. A headless
Chrome print onto 80 x 210mm paper puts the ticket's text from 1mm down. Headless printing does not
reproduce the print window's centring of a declared size, so the before/after difference rests on
the owner's photo, not a test. `e2e/printing.spec.ts` checks the page rule and the printed document,
in Chrome and in Safari's engine.

What the page cannot choose is the paper length. Per till, once, in the print window's More
settings: Margins None, Headers and footers unticked, Paper size the roll's width — the longest
length first (many drivers stop right after the content now there is no footer at the far end), the
shortest (e.g. 80 x 210mm) if it keeps feeding. Failing that, the driver's blank-trimming option in
Windows Printing preferences. The steps are in every print dialog ("Printer keeps feeding blank
paper?"). The one fix that removes the driver from the picture is printing raw ESC/POS (QZ Tray, or
Web Serial where the printer has a COM port) — a bigger job, not started.

**Any paper width (26 September 2026).** Every print dialog has a Paper row: 58 mm, 80 mm, or Other
(any whole number of millimetres, 40–210). Remembered per device in localStorage, separately for
receipts and kitchen tickets (a till often has two printers). `src/lib/paper-width.ts` fits the
ticket: 5mm unprinted each side, type scaled down on narrow rolls to about a 58mm printer's own
(32 characters a line) and no further — below that lines wrap — and wide rolls keep the usual type
with more on each line, the ticket capped at 104mm wide. The dialog's preview wraps where the paper
will. Default 80mm, so nothing changes for a device until someone picks another width.

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
  to agree with it to the paisa for a day and for a week. Owners and managers only; an owner with
  several branches can look at one at a time, each on its own clock. The dashboard's sales card
  switches between today, yesterday, 7 days, 30 days and this month, each against the period
  before it.
- **A café's day can end after midnight** — each branch sets when its day ends (midnight to 6am, on
  the Branches screen). A 1:30am sale then counts in tonight's takings, drawer and closing, and the
  Sales report, cash drawer, dashboard and WhatsApp summary all follow the same setting.
- **A bill before payment** — priced once per way of paying, so a PRA branch prints the cash and the
  card total, each exactly what payment then charges. The kitchen ticket is unchanged.
- **Sign-in ignores capitals and stray spaces** in the email and restaurant code.
- **The till on tablets and phones** — the menu and the order sit side by side on a tablet; on a
  phone the order opens as a sheet from a bar at the bottom.
- **Changing an order after it is punched** — void one item (or some of a quantity) with a reason,
  switch dine-in and takeaway, merge two tables onto one bill, or sell an order without tax with
  the reason printed on the bill. After each, the order costs exactly what a fresh order of its
  remaining items would; the tests compare against the live price, and each was broken on purpose
  to prove it. Item voids show on the kitchen screen and in the voids report; the kitchen can take
  back a mis-tapped "Ready"; a no-sale drawer opening is recorded against the day's drawer.
- **The till hears about orders placed elsewhere** — a waiter's phone, an online or QR order pops up
  on every till that takes payment ("New order #123 · Table 4 · by Ali · Rs 1,250", with Open), with
  a chime each device can mute and a count of orders still to be paid on the Order Queue button.
  Whoever placed an order is told when the kitchen marks it ready; a customer's online or QR order
  is announced as ready at the counter. The live channel carries only an order's id — details are
  fetched through the till's own session — and a 15-second check covers the channel being down.
- **Waiter orders can wait for the counter** (27 September 2026) — a switch per branch on the
  Branches page, off by default (`BranchSettings.waiterOrdersNeedApproval`). On, the orders of
  anyone who can't take payment (`pos.payment.take`) wait: a new order stays OPEN and out of the
  kitchen; another round isn't added to the order, the bill or the kitchen at all. The cashier's
  till pops up "Order #123 needs your approval" with the chime and a "to approve" count, and the
  Order Queue lists each request with Send to kitchen / Reject (a reason, which the waiter sees).
  Rejected, a new order is voided ("Not approved: …") and its table freed. Payment is refused while
  anything on the order waits; voiding or cancelling an order closes its requests. The waiter's
  button reads "Send for approval" and they are told the outcome. Offline sends replay through
  the same check. `src/server/order-approvals.ts`, table `OrderApproval` (RLS),
  `e2e/order-approvals.spec.ts`.
- **"ToffeeOS by Krimsols · @krimsols" on receipts and bills** (27 September 2026) — one line at
  the foot of every customer-facing receipt and bill (not kitchen tickets, summaries or no-sale
  slips), with the Instagram mark drawn as a plain-line SVG so it prints crisp on thermal paper.
  On for every restaurant (`Tenant.showReceiptCredit`, default true); only the platform admin can
  switch it off, per restaurant, on the platform's restaurant page ("Receipt credit") — audited as
  `platform.receiptCredit.change`. `e2e/receipt-credit.spec.ts`.
- **The Order Queue is today's** (27 September 2026) — this business day's orders only (the branch's
  own day, so a branch whose day starts at 4am keeps 1:30am orders with the evening's), via
  `GET /api/orders?day=today`; the number on the button counts today's unpaid. An earlier day's
  order still unpaid is folded away at the foot ("Earlier days · N not paid"), not dropped — a table
  seated at 11:30pm is still eating at 12:15 in a branch whose day starts at midnight. Other screens
  still use the unfiltered list to find an order by id. `e2e/order-queue-today.spec.ts`.
- **A waiter at a table already eating** (27 September 2026) no longer sees Take Payment (they can't)
  as the only big button; Add items leads, and tapping a dish on the menu starts the next round —
  those taps used to go into a hidden cart that "Add items" then emptied.
- **Buying stock** — suppliers, and purchase orders that go draft → approved → received, each step
  its own permission; what arrived (not what was ordered) is counted into stock and the P&L's stock
  purchases. A transfer asked for by someone who can't approve waits until someone can. A stock
  adjustment made in error is undone by an opposite one — nothing deleted, and only once.
- **Loyalty points** — off until an owner switches it on (Customers). Earned inside payment's own
  transaction, spent at the till as money off, given back if that bill is voided, and taken back in
  proportion when a bill is refunded, so the scheme can't be gamed by earn-spend-refund.
- **Per-branch prices, the online menu, and delivery cash** — a dish can cost more at one branch;
  a dish can be kept off the online and QR menus while the till still sells it; and the rider's cash
  on a cash-on-delivery order is marked received from the Delivery screen, which is what finally
  puts those orders into the sales figures.

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
set up email DNS. The migrations are all applied (section 1). That is the difference between software that
works and a business you can invoice from.

Everything in section 3 is a conversation to have with a café before they sign, not a reason to
wait.
