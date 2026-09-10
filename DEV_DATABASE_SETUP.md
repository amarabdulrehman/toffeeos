# Standing up a second Supabase project for dev/test

Why: right now local dev, the Playwright suite and production all point at one database. That is
what let a password committed in this repo open a live production account, it is why
`e2e/tenant-delete.spec.ts` deletes real tenants, and it is why ~45 of 65 tenant rows are test
residue. See `PRE_LAUNCH_REPORT.md` §2.4.

Doing this also **is** the fresh-database migration test that has never been run. If the migrations
don't replay cleanly from zero, this is where you find that out — safely, rather than during a
restore.

Budget note: Supabase's free tier allows two active projects per organisation. You have one.

---

## 1. Create the project

Dashboard → New project.

- **Region: `ap-southeast-1` (Singapore).** Match production. The app is pinned to `sin1` in
  `vercel.json` precisely so it sits next to the database; a mismatched dev region will make
  everything feel slow for reasons that have nothing to do with your code.
- Set a strong database password when prompted — this is the `postgres` role password. Keep it.
- Note the **project ref** (the random string in the project URL).

## 2. Point `DIRECT_URL` at it and migrate

Temporarily, in `.env`:

```
DIRECT_URL="postgresql://postgres.<NEW_REF>:<POSTGRES_PW>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
```

Then:

```bash
npx prisma migrate deploy
```

All 37 migrations should apply. **If this fails, stop and read the error** — that is the fresh-replay
problem surfacing, and it is worth knowing about before you ever need a restore.

## 3. Give the two runtime roles passwords — the step that is easy to miss

`prisma migrate deploy` creates `app_user` and `platform_user`, but as `NOLOGIN` with **no
password**. That is deliberate: the `rls_and_roles` migration says so in its header, so a real
credential never lands in git. The consequence is that a freshly migrated database has two roles the
app cannot connect as, and the failure looks like an unexplained auth error from Prisma.

In the Supabase SQL editor for the **new** project:

```sql
ALTER ROLE app_user      WITH LOGIN PASSWORD '<strong secret #1>';
ALTER ROLE platform_user WITH LOGIN PASSWORD '<strong secret #2>';
```

Two different secrets. Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## 4. Fill in the rest of `.env`

Note the username format Supabase's pooler uses — `<role>.<project-ref>`, not just `<role>`:

```
DATABASE_URL="postgresql://app_user.<NEW_REF>:<secret #1>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<NEW_REF>:<POSTGRES_PW>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
PLATFORM_DATABASE_URL="postgresql://platform_user.<NEW_REF>:<secret #2>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

NEXT_PUBLIC_SUPABASE_URL="https://<NEW_REF>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<new project's anon key>"
SUPABASE_SERVICE_ROLE_KEY="<new project's service_role key>"
```

Ports matter: **6543 + `pgbouncer=true`** for the two runtime URLs (transaction pooling, which is
what makes this work on serverless), **5432** for `DIRECT_URL` (migrations only).

Leave `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL` and the rest as they are.

**Do not touch Vercel's environment variables.** Production keeps pointing at the original project.

## 5. Verify before trusting it

```bash
npx tsx prisma/verify-database-setup.ts
```

Ten checks: migrations applied, both roles exist and can log in, `app_user` cannot bypass RLS,
`platform_user` can, RLS enabled *and forced* on every tenant table, and `anon`/`authenticated`
locked out of the public schema. Any failure prints the exact SQL or command to fix it.

This is the same script that reports all-pass against production today, so a clean run means the new
project genuinely matches.

## 6. Seed it

```bash
npm run seed
```

Requires `DEMO_SEED_PASSWORD` and `PLATFORM_SEED_PASSWORD` in `.env` — both now throw rather than
falling back to a committed default. Use different values here than production's.

## 7. Run the suite against it

```bash
rm -f e2e/.auth/*.json     # force a fresh login against the new database
npx playwright test
```

Expect **88 passed, 1 skipped**. From here the suite creates and deletes tenants in a database that
is not serving your clients.

---

## After it works

- **Clean production.** With tests no longer writing there, delete the ~45 test tenants via the
  platform admin's tenant deletion. Confirm first which of `slice`, `bigmac` and `sigma` are yours —
  `karachi-karahi` is the demo tenant.
- **Rehearse a restore.** Take the newest `full-backup-*.json.gz` from the `db-backups` bucket and
  restore it into this new project. Backups run nightly and are verified as *produced*; they are not
  yet verified as *restorable*, and this is now a safe place to find out.
- **Consider dropping the demo tenant from production** entirely. Once the suite lives elsewhere,
  production has no reason to host it.
