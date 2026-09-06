import "server-only";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { platformDb, tenantDb } from "@/server/db";
import { verifyPassword, verifyPin } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { edgeAuthConfig } from "./edge-config";
import { buildTenantSessionUser, findTenantBySlug, tenantAcceptsLogin } from "./session-user";
import { verifyOtp } from "./otp-store";
import { verifyTotpOrBackupCode } from "@/server/platform-mfa";
import { consumeImpersonationToken } from "./impersonation-store";
import { clockIn } from "@/server/hr";
import type { PlatformSessionUser, SessionUser } from "./types";

// NextAuth's `authorize()` return type is nominally `User`, but our sessions carry a much richer,
// discriminated-union shape (tenant vs platform). Rather than fight NextAuth's typing, we widen at
// this one boundary (authorize's return, and jwt's `user` param) and keep everything else in the
// codebase strictly typed against SessionUser. See src/server/auth/types.ts.
type LooseUser = Record<string, unknown>;

const tenantCredentialsSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

const pinSchema = z.object({
  tenantSlug: z.string().min(1),
  branchId: z.string().min(1),
  pin: z.string().min(4).max(8),
});

const otpSchema = z.object({
  tenantSlug: z.string().min(1),
  phone: z.string().min(1),
  code: z.string().min(4).max(8),
});

const platformCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Only required when the account has 2FA enabled — see /api/platform/mfa/check, which the login
  // page calls after password verification to decide whether to show this field at all. Always
  // present in the actual signIn() payload (as "" when 2FA doesn't apply), so no .min(1) here —
  // that would reject the whole parse on an empty string instead of just falling through to the
  // falsy check below.
  totpCode: z.string().optional(),
});

const impersonateSchema = z.object({ token: z.string().min(1) });

export const authConfig = {
  ...edgeAuthConfig,
  providers: [
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        tenantSlug: { label: "Restaurant", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw): Promise<LooseUser | null> {
        const parsed = tenantCredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { tenantSlug, email, password } = parsed.data;

        const tenant = await findTenantBySlug(tenantSlug);
        if (!tenant || !tenantAcceptsLogin(tenant.status)) return null;

        // The primary login path for every tenant staff member — was the one credentials provider
        // with no attempt limiting at all. Keyed per-account (tenant + email), same reasoning as
        // staff-pin's per-branch key: the natural boundary a real user never exceeds, that a
        // credential-stuffing attempt against one account would.
        if (!(await checkRateLimit(`login:${tenant.id}:${email}`, 8, 15 * 60 * 1000))) return null;

        const user = await tenantDb(tenant.id).user.findFirst({ where: { email } });
        if (!user || !user.isActive || !user.passwordHash) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        const sessionUser = await buildTenantSessionUser(tenant.id, user.id);
        return sessionUser as unknown as LooseUser;
      },
    }),

    Credentials({
      id: "staff-pin",
      name: "Staff PIN",
      credentials: {
        tenantSlug: { label: "Restaurant", type: "text" },
        branchId: { label: "Branch", type: "text" },
        pin: { label: "PIN", type: "password" },
      },
      async authorize(raw): Promise<LooseUser | null> {
        const parsed = pinSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { tenantSlug, branchId, pin } = parsed.data;

        const tenant = await findTenantBySlug(tenantSlug);
        if (!tenant || !tenantAcceptsLogin(tenant.status)) return null;

        // A PIN is only 4 digits (10,000 combinations) checked against every active membership on
        // this branch at once — that's the natural attempt boundary an attacker is bound by, so
        // it's what this is keyed on rather than per-user. 8 attempts/10 min is generous for a
        // fumbling cashier, punishing for a script.
        if (!(await checkRateLimit(`staff-pin:${tenant.id}:${branchId}`, 8, 10 * 60 * 1000))) return null;

        const db = tenantDb(tenant.id);
        const memberships = await db.membership.findMany({
          where: { branchId, isActive: true },
          include: { user: { include: { staffPin: true } } },
        });

        for (const m of memberships) {
          const pinHash = m.user.staffPin?.pinHash;
          if (!pinHash || !m.user.isActive) continue;
          if (await verifyPin(pin, pinHash)) {
            // Reuses the PIN pad as the attendance clock, per the Phase 4 brief — no separate
            // kiosk flow. clockIn() is a no-op if this person already has an open record for this
            // branch, so re-entering a PIN mid-shift doesn't fragment their attendance.
            await clockIn(tenant.id, branchId, m.userId);
            const sessionUser = await buildTenantSessionUser(tenant.id, m.userId, branchId);
            return sessionUser as unknown as LooseUser;
          }
        }
        return null;
      },
    }),

    Credentials({
      id: "otp",
      name: "Phone OTP",
      credentials: {
        tenantSlug: { label: "Restaurant", type: "text" },
        phone: { label: "Phone", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(raw): Promise<LooseUser | null> {
        const parsed = otpSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { tenantSlug, phone, code } = parsed.data;

        const tenant = await findTenantBySlug(tenantSlug);
        if (!tenant || !tenantAcceptsLogin(tenant.status)) return null;
        if (!(await verifyOtp(`${tenant.id}:${phone}`, code))) return null;

        const user = await tenantDb(tenant.id).user.findFirst({ where: { phone } });
        if (!user || !user.isActive) return null;

        const sessionUser = await buildTenantSessionUser(tenant.id, user.id);
        return sessionUser as unknown as LooseUser;
      },
    }),

    Credentials({
      id: "platform-credentials",
      name: "Platform Admin",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw): Promise<LooseUser | null> {
        const parsed = platformCredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, totpCode } = parsed.data;

        // The single most sensitive account in the system (BYPASSRLS, every tenant) had zero
        // attempt limiting — fixed the same way as the tenant login above.
        if (!(await checkRateLimit(`platform-login:${email}`, 8, 15 * 60 * 1000))) return null;

        const platformUser = await platformDb.platformUser.findUnique({ where: { email } });
        if (!platformUser) return null;
        if (!(await verifyPassword(password, platformUser.passwordHash))) return null;

        if (platformUser.totpEnabled) {
          if (!totpCode || !(await verifyTotpOrBackupCode(platformUser, totpCode))) return null;
        }

        const sessionUser: PlatformSessionUser = {
          kind: "platform",
          id: platformUser.id,
          name: platformUser.name,
          email: platformUser.email,
          sessionsValidFrom: platformUser.sessionsValidFrom.getTime(),
        };
        return sessionUser as unknown as LooseUser;
      },
    }),

    // Hand-off from POST /api/platform/tenants/[tenantId]/impersonate: the platform admin's
    // browser is redirected to /impersonate?token=... which immediately calls signIn("impersonate",
    // {token}). The token is single-use and 60s-lived (impersonation-store.ts) — it only exists to
    // avoid putting a raw userId in a URL, not as a standing credential.
    Credentials({
      id: "impersonate",
      name: "Impersonation",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(raw): Promise<LooseUser | null> {
        const parsed = impersonateSchema.safeParse(raw);
        if (!parsed.success) return null;
        const grant = await consumeImpersonationToken(parsed.data.token);
        if (!grant) return null;

        const sessionUser = await buildTenantSessionUser(grant.tenantId, grant.targetUserId);
        if (!sessionUser) return null;
        sessionUser.impersonatedByPlatformUserId = grant.platformUserId;
        sessionUser.impersonatedByPlatformUserEmail = grant.platformUserEmail;
        return sessionUser as unknown as LooseUser;
      },
    }),
  ],
  callbacks: {
    ...edgeAuthConfig.callbacks,
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.user = user as unknown as SessionUser;
      }
      // Branch switch: the client calls `update({ branchId })`; re-resolve permissions for that
      // membership rather than trusting the client to supply them.
      if (trigger === "update" && token.user?.kind === "tenant") {
        const requestedBranchId = (session as { branchId?: string } | undefined)?.branchId;
        if (requestedBranchId) {
          const rebuilt = await buildTenantSessionUser(token.user.tenantId, token.user.id, requestedBranchId);
          if (rebuilt) {
            rebuilt.impersonatedByPlatformUserId = token.user.impersonatedByPlatformUserId;
            rebuilt.impersonatedByPlatformUserEmail = token.user.impersonatedByPlatformUserEmail;
            token.user = rebuilt;
          }
        }
      }
      return token;
    },
  },
} satisfies NextAuthConfig;
