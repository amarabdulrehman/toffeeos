import "dotenv/config";
import { Client } from "pg";

/**
 * Checks that whatever database DIRECT_URL points at is actually set up the way this app requires.
 *
 * Written for standing up a second Supabase project (dev/test, so the suite stops running against
 * production — see PRE_LAUNCH_REPORT.md §2.4), but it works against any of them. Run it after
 * `prisma migrate deploy` and the manual ALTER ROLE step; it tells you which of the two you missed.
 *
 * The role passwords in particular are easy to miss: the rls_and_roles migration creates app_user
 * and platform_user as NOLOGIN and deliberately does NOT set passwords, so migrating a fresh
 * database leaves you with roles the app cannot connect as. That failure looks like an auth error
 * from Prisma with nothing pointing at the cause.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function run(): Promise<void> {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL is not set — point it at the database you want to verify.");

  const host = url.match(/@([^/]+)/)?.[1] ?? "unknown";
  console.log(`Verifying database at ${host}\n`);

  const c = new Client({ connectionString: url });
  await c.connect();
  const checks: Check[] = [];

  // 1. Migrations applied.
  const migrations = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
  ).catch(() => null as never);
  const migrationCount = migrations ? Number(migrations.rows[0].n) : 0;
  checks.push({
    name: "Migrations applied",
    ok: migrationCount > 0,
    detail: migrationCount > 0 ? `${migrationCount} applied` : "none — _prisma_migrations missing or empty",
    fix: "npx prisma migrate deploy",
  });

  // 2. Both runtime roles exist, can log in, and platform_user alone bypasses RLS.
  const roles = await c.query<{ rolname: string; rolcanlogin: boolean; rolbypassrls: boolean }>(
    `SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname IN ('app_user','platform_user')`
  );
  const byName = new Map(roles.rows.map((r) => [r.rolname, r]));

  for (const role of ["app_user", "platform_user"] as const) {
    const r = byName.get(role);
    checks.push({
      name: `Role ${role} exists`,
      ok: !!r,
      detail: r ? "present" : "missing",
      fix: "npx prisma migrate deploy (the rls_and_roles migration creates it)",
    });
    if (r) {
      checks.push({
        name: `Role ${role} can log in`,
        ok: r.rolcanlogin,
        detail: r.rolcanlogin ? "LOGIN set" : "NOLOGIN — no password has been set",
        fix: `ALTER ROLE ${role} WITH LOGIN PASSWORD '<a strong secret>';  -- run in the SQL editor`,
      });
    }
  }

  const appUser = byName.get("app_user");
  if (appUser) {
    checks.push({
      name: "app_user cannot bypass RLS",
      ok: !appUser.rolbypassrls,
      detail: appUser.rolbypassrls ? "BYPASSRLS IS SET — tenant isolation is void" : "rolbypassrls = false",
      fix: "ALTER ROLE app_user NOBYPASSRLS;",
    });
  }
  const platformUser = byName.get("platform_user");
  if (platformUser) {
    checks.push({
      name: "platform_user bypasses RLS (by design)",
      ok: platformUser.rolbypassrls,
      detail: platformUser.rolbypassrls ? "BYPASSRLS set" : "not set — the platform admin panel will see nothing",
      fix: "ALTER ROLE platform_user BYPASSRLS;",
    });
  }

  // 3. RLS enabled AND forced on every table carrying a tenantId.
  const rls = await c.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                     WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='tenantId')`
  );
  const noRls = rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  const noForce = rls.rows.filter((r) => r.relrowsecurity && !r.relforcerowsecurity).map((r) => r.relname);
  // pg types rowCount as number | null; rls.rows.length is the same count without the null case.
  const tenantTableCount = rls.rows.length;
  checks.push({
    name: "RLS enabled on every tenant table",
    ok: tenantTableCount > 0 && noRls.length === 0,
    detail:
      tenantTableCount === 0
        ? "no tenant tables found at all"
        : noRls.length
          ? `missing on: ${noRls.join(", ")}`
          : `${tenantTableCount} tables`,
    fix: "npx prisma migrate deploy (the *_rls migrations)",
  });
  checks.push({
    name: "RLS is FORCED (owner cannot bypass)",
    ok: noForce.length === 0,
    detail: noForce.length ? `not forced on: ${noForce.join(", ")}` : "all forced",
    fix: 'ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;',
  });

  // 4. Supabase's anon/authenticated must hold nothing on the public schema.
  const grants = await c.query<{ grantee: string; n: string }>(
    `SELECT grantee, count(*)::text AS n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated','public') GROUP BY grantee`
  );
  checks.push({
    name: "anon/authenticated locked out of public schema",
    ok: grants.rowCount === 0,
    detail: grants.rowCount === 0 ? "no grants" : grants.rows.map((g) => `${g.grantee}=${g.n}`).join(", "),
    fix: "npx prisma migrate deploy (revoke_public_role_grants)",
  });

  await c.end();

  const pad = Math.max(...checks.map((c2) => c2.name.length));
  let failed = 0;
  for (const ch of checks) {
    if (!ch.ok) failed++;
    console.log(`  ${ch.ok ? "PASS" : "FAIL"}  ${ch.name.padEnd(pad)}  ${ch.detail}`);
  }
  if (failed) {
    console.log(`\n${failed} check(s) failed. To fix:`);
    for (const ch of checks.filter((c2) => !c2.ok && c2.fix)) console.log(`  - ${ch.name}\n      ${ch.fix}`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} checks passed — this database is set up correctly.`);
}

run().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
