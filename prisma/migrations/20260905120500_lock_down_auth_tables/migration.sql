-- SECURITY: take the auth-secret tables away from app_user, the role every tenant request runs as.
--
-- These five are reached exclusively through platformDb (verified by grepping every call site):
-- password reset tokens, OTP codes, impersonation grants, platform admin accounts, and the rate
-- limiter's ledger. app_user never legitimately touches any of them, yet held SELECT/INSERT/UPDATE/
-- DELETE on all five while none had RLS — so any SQL-injection foothold in tenant-facing code was a
-- direct path to a live password-reset token or the super-admin's bcrypt hash.
--
-- Privilege revocation is the real control here, not RLS: these tables have no legitimate
-- app_user rows to filter down to, so "no access at all" is the correct answer rather than a
-- row predicate. RLS is enabled alongside it purely as defence-in-depth, so that a future migration
-- which re-grants app_user by accident still fails closed.
--
-- Safe for the app: platform_user and postgres both have rolbypassrls, so platformDb and the
-- migration runner are unaffected. Verified before writing.
--
-- Plan and Tenant are deliberately NOT included. rawDb reads both before a session exists —
-- findTenantBySlug resolves the tenant at login, which happens before app.tenant_id can be set —
-- so revoking them (or adding a tenant-scoped policy) would break sign-in outright. Their exposure
-- was via the public anon role, which the previous migration already revoked.

REVOKE ALL PRIVILEGES ON TABLE
  "PasswordResetToken", "OtpCode", "ImpersonationToken", "PlatformUser", "RateLimitHit"
  FROM app_user;

ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OtpCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpCode" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ImpersonationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImpersonationToken" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PlatformUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformUser" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitHit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitHit" FORCE ROW LEVEL SECURITY;
