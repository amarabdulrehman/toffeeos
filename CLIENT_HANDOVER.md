# Handing ToffeeOS to Spill

Written 19 September 2026, for the handover tomorrow morning.

Read the first two sections before you hand anything over. The rest is reference.

---

## 1. You cannot legally charge Spill yet

**The Vercel account is on the Hobby plan, and Hobby prohibits commercial use.** This is not a
performance limit you can live with for a while — it is the terms of service. The moment Spill pays
you, the deployment is in breach and Vercel can suspend it without notice, which would take the
till down mid-service.

This is the one blocker I cannot work around and cannot fix for you. Upgrading to Pro is a
five-minute job and it has to happen before money changes hands.

## 2. Four things still need your machine

I have no production database credentials — Vercel marks them sensitive, so `vercel env pull`
returns placeholders rather than values. Everything below therefore has to be run by you.

### a. Apply the database migrations

**Two** are pending. `git push` does **not** apply them — the build runs
`prisma generate && next build`, not `migrate deploy`.

- `20260914211549_index_unindexed_foreign_keys` — nine foreign keys with no index, including
  `Order.tableId`, which the POS reads on every dine-in sitting.
- `20260919174041_add_max_discount_cap` — the discount ceiling. **The cap cannot work until this
  runs**, and until then every branch is uncapped.

```bash
DIRECT_URL='<prod>' DATABASE_URL='<prod>' npx prisma migrate status   # expect 2 pending
DIRECT_URL='<prod>' DATABASE_URL='<prod>' npx prisma migrate deploy
```

If `status` lists more than those two, stop and show me — production would be further behind than
I believe.

### b. Create Spill on production

The tenant exists only in development. The seed script builds the whole menu — 16 categories, 78
items, 74 sizes, 4 add-on groups — in one run.

```bash
SPILL_BASE_URL=https://toffeeos.vercel.app \
DIRECT_URL='<prod>' DATABASE_URL='<prod>' \
SPILL_OWNER_EMAIL=owner@spill.pk SPILL_OWNER_PASSWORD='<pick a fresh one>' \
npm run seed:spill
```

Do **not** reuse the development password — it has been sitting in our chat all week. Expect
`16 categories, 78 items, 74 size variants`.

### c. Check the backups are actually running

The nightly backup writes to the `db-backups` bucket in production's Supabase project. I have never
been able to see that project, so I have never confirmed a single backup exists there. The cron is
configured and `CRON_SECRET` is set, but the route fails closed and silently — a failing job looks
identical to a working one from outside.

Open Supabase → Storage → `db-backups` and look at the newest object's date. If it is not from the
last day or two, the backup has never run and the free-tier backup story is fiction.

### d. Set up email DNS

Three DNS records. Until they exist, password-reset emails may not deliver, and a locked-out
manager at 8pm on a Friday has no way back in except you.

---

## 3. Gaps Spill will hit, in the order they will hit them

### There is no way to reverse a paid order

`pos.payment.refund` exists as a permission string and nowhere else — no route, no schema field, no
code. A paid order cannot be voided either: `PAID` is a terminal status, so `voidOrder` refuses it
by design.

Once money is taken, **nothing in the software can undo it.** A wrongly rung-up bill, a returned
dish, a double charge — all of it gets settled in cash off-system and reconciled by hand, and the
day's reports will disagree with the till.

For a café doing real covers this is the first thing they will ask for. Budget it.

### A cashier can zero any bill — until you set the cap

This one is now built, but **it is off until you turn it on**, so it still needs you.

The problem it fixes: "Exceed maximum discount" sat in the roles screen gating nothing, because no
stored maximum existed for it to check against. Signed in as the seeded cashier, who does *not*
hold that permission, I put a Rs 1,000 order through at 100% off and the server wrote a **Rs 0**
order.

Branches → Order settings now has **"Largest discount staff may apply (%)"**. Staff whose role
grants "Exceed maximum discount" are not bound by it; everyone else is, and a rupee discount is
measured as a percentage of the same bill so the cap cannot be dodged by switching the discount
type.

**It defaults to 100%, which means no limit.** That default is deliberate — anything lower would
have silently started refusing discounts every existing branch allows the moment it deployed. So
after the migration runs, set it for Spill. Twenty percent is a common starting point; the number
is theirs to choose.

### WhatsApp says messages were sent that nothing sends

No WhatsApp provider is wired up. The adapter is a stub and every message is recorded as **SENT**.
Making it honest flips every message in every log from SENT to FAILED at once — true, and visible
to Spill. Your call, but do not let them discover it during a promotion.

### 30 of 94 permissions gate nothing

The roles screen renders straight from the registry, so an owner can toggle 31 switches that change
no behaviour — "Issue a refund" and "Reprint KOT" among them ("Exceed maximum discount" came off
this list tonight). Most
correspond to features that do not exist yet. A test now fails if the number grows, so the decision
gets made when a permission is written rather than when a client finds out.

### No tips, and no per-guest bill splitting

Several tenders against one order works, and so does partial settlement — "cash plus card" is fine.
What does not exist is splitting a bill between guests into separate receipts, and there is no tip
or gratuity field anywhere. The service charge probably covers tipping for this market; the split
bill is worth asking Spill about before they find out on a busy night.

### Sizes and add-ons are editable; almost nothing else about them is

As of tonight Spill can create sizes and add-on groups themselves from the menu screen. What they
still cannot do is reorder them, or rename a group without deleting and recreating it.

---

## 4. Infrastructure risk worth naming

**The connection between this machine and Supabase is unreliable.** I measured a ~10% failure rate
on direct connection probes, and it destroyed three consecutive test runs tonight — `ENOTFOUND`,
`ETIMEDOUT`, and a dev server that died mid-suite. One full run took 48 minutes against a usual 25,
because half the time was spent waiting on connections that then failed.

If that is your network, it is an annoyance. If it is the route to Supabase from Pakistan generally,
it will show up as a till that stalls mid-order during service. The offline queue covers a total
outage well — that is the product's headline feature and it is properly tested — but a connection
that is up, slow, and intermittently failing is the harder case.

Worth ten minutes with a different network before you decide it is nothing.

---

## 5. What is solid

Verified tonight against the complete code:

- **134 end-to-end tests and 137 unit tests, all passing**, with a clean production build.
- **Offline** — orders punched during an outage queue locally and sync once, with the exact charged
  amount, no drift.
- **Money** — Punjab PRA split rates (16% cash, 8% card), integer paisa throughout, single rounding,
  apportionment that always sums to the whole.
- **Tenant isolation** — one tenant cannot read or write another's orders, tax rules or staff, tested
  against a real second tenant created through the public signup flow.
- **Branch isolation on payroll** — a branch manager cannot change pay or disburse at another branch.
- **Password reset** — tokens stored as a SHA-256 fingerprint, claimed atomically, single-use,
  expiring, and revoking every live session.
- **Impersonation** — single-use, audit-logged before the admin follows through.
- **Accessibility and responsive** — every staff screen and every public page, at phone, tablet and
  laptop.

Every fix in the last few days was verified by deliberately breaking it and watching the right test
fail, then restoring it. A guard nobody has seen fail is a guard nobody has tested.

---

## 6. A mistake of mine you should know about

The sizes-and-add-ons feature was pushed in two halves by accident. The first commit contained only
the eleven new files; the five modified ones — including the order-engine validation — were left
out, because I ran `git stash` between staging and committing to check whether a lint error
pre-dated my changes, and did not verify what the commit actually contained before pushing.

For two days production therefore had the API to *create* add-ons without the check that stops one
item's add-on being applied to another. It is tenant-scoped through RLS and production carries only
the demo tenant, so nothing real was exposed — but it was live, and it was my error. It is fixed in
the commit that follows, and the whole feature is verified together.

---

## 7. Credentials

**Development Spill tenant** — restaurant `spill`, `owner@spill.pk`, password `SpillOwner!2026`.
Development only. Do not reuse this for the production tenant.

**Development database password** is still `Amarabdulrehman123` and has been in our chat. It is
development-only, which I have confirmed — production is a genuinely separate database — but change
it when you get a moment.
