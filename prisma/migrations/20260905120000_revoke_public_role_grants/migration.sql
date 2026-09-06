-- SECURITY: revoke Supabase's PostgREST roles from the public schema.
--
-- `anon` is the role behind NEXT_PUBLIC_SUPABASE_ANON_KEY, which ships in the browser bundle of a
-- public site. Supabase grants anon/authenticated full DML on every table in `public` by default,
-- and this project never removed it. That made the whole schema readable and writable by anyone who
-- opened devtools, via PostgREST at /rest/v1/<table>.
--
-- RLS did NOT contain this:
--   * 7 tables had no RLS at all (PlatformUser, PasswordResetToken, OtpCode, ImpersonationToken,
--     Tenant, Plan, RateLimitHit) — password-reset tokens and the super-admin's bcrypt hash were
--     straightforwardly readable.
--   * TRUNCATE is a table-level privilege that RLS does not restrict, and anon held it on all 55
--     tables — so even correctly RLS-protected tables (Order, User, Payment) could be wiped.
--
-- This app never uses those roles: it connects as app_user / platform_user over Prisma, and the
-- only supabase-js usage is Storage (its own `storage` schema) and Realtime *broadcast*, which
-- needs no table grants. Verified before writing this: no postgres_changes subscription and no
-- .from() table access anywhere in src/.
--
-- Revoking schema USAGE is the load-bearing line — without it the roles cannot reach an object in
-- `public` even if a future migration re-grants table privileges by accident.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- Stop future tables inheriting the same hole. Only affects defaults recorded for the role running
-- this; Supabase records a second set under supabase_admin that a customer-level role cannot alter,
-- which is why the schema-level USAGE revoke above is the real backstop.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
