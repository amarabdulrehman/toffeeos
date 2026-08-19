# TableOS

Multi-tenant restaurant management SaaS for Pakistan's restaurants, cafés, and cloud kitchens —
POS, Kitchen Display System, staff/permissions, reports, and a super-admin panel, all in one
codebase serving every tenant with isolated data.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)-equivalent context in the original plan doc for
the full design rationale (tenant isolation, the pricing engine, permissions). This README is just
setup.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui (Base UI) · Prisma 7 (`@prisma/adapter-pg`)
· PostgreSQL (Supabase) · Auth.js v5 · Supabase Realtime · Vitest.

## Phase 1 scope

Multi-tenant auth (email/password, staff PIN, phone OTP) → POS (dine-in/takeaway/delivery/service,
split payments, live pricing) → Kitchen Display System → sales/item-wise reports → a read-only
super-admin tenant list. Table/floor UI, inventory, delivery/riders, the full report suite, CRM,
billing, offline sync, and WhatsApp integrations are Phase 2–4 (see the plan doc).

## 1. Create a Supabase project

You need a free [Supabase](https://supabase.com) project — this app uses its Postgres database,
Realtime, and Storage.

1. Create a project, note the project ref and database password.
2. In the SQL editor, you'll run the migrations below — they create two additional Postgres roles
   (`app_user`, `platform_user`) used for tenant isolation (see
   `prisma/migrations/*_rls_and_roles/migration.sql`).

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` — the **pooled** connection (Supabase "Transaction pooler", port 6543,
  `?pgbouncer=true`), once you've set a password for `app_user` (step 4).
- `DIRECT_URL` — the **unpooled** connection (port 5432) on the `postgres` owner role. Used only
  for migrations.
- `PLATFORM_DATABASE_URL` — pooled connection on `platform_user` (step 4).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from
  Supabase Project Settings → API.
- `AUTH_SECRET` — generate with `npx auth secret`.

## 3. Run migrations

```bash
npm install
npx prisma migrate deploy
```

This applies two migrations: the schema itself, then the hand-written RLS/roles migration. The
RLS migration creates `app_user` and `platform_user` as `NOLOGIN` roles — **you must set their
passwords yourself, in the Supabase SQL editor, so a real secret never lands in git history**:

```sql
ALTER ROLE app_user WITH LOGIN PASSWORD 'a-strong-secret';
ALTER ROLE platform_user WITH LOGIN PASSWORD 'a-different-strong-secret';
```

Then update `DATABASE_URL` / `PLATFORM_DATABASE_URL` in `.env` with those passwords.

## 4. Seed demo data

```bash
npm run seed
```

Creates:

- 3 subscription plans (Starter/Growth/Enterprise)
- A platform admin: `admin@tableos.app` / `ChangeMe123!` → sign in at `/platform/login`
- A demo tenant **"Karachi Karahi House"** (slug `karachi-karahi`) with 2 branches, ~35 menu items,
  the Punjab PRA split-rate tax seed (16% cash / 8% card & digital), a floor of 8 tables, and staff
  for all 6 roles — password `Passw0rd!` for everyone, PIN `1234` for cashier/waiter/kitchen. Sign
  in at `/login` with restaurant URL `karachi-karahi`.

## 5. Run it

```bash
npm run dev
```

- `/` — landing → `/signup` (new tenant) or `/login` (existing staff)
- `/pos` — the POS terminal
- `/kds` — the kitchen display
- `/app/dashboard`, `/app/reports` — back office
- `/platform/tenants` — super-admin panel

## Tests

```bash
npm test
```

Covers `src/lib/money.ts` and `src/lib/pricing.ts` — the money-math engine — including the split
cash+card payment case where each tender is taxed at its own Punjab PRA rate.

## Known Phase 1 simplifications

- POS modifier-group selection UI isn't wired up yet (the schema/API support it; only variants are
  selectable in the cart today).
- Phone OTP uses an in-memory dev stub (`src/server/auth/otp-store.ts`) — logs the code to the
  server console instead of sending WhatsApp/SMS. Swap before going live.
- KDS SLA threshold is a client-side constant; `BranchSettings.kdsSlaSeconds` exists in the schema
  but isn't yet read by the KDS UI.
- Menu management back-office UI is minimal (seed data is the primary way to populate a tenant's
  menu right now); the API (`POST /api/menu`) exists for categories.
