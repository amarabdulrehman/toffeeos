import "server-only";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { platformDb, tenantDb } from "@/server/db";
import { verifyPassword, verifyPin } from "@/lib/password";
import { edgeAuthConfig } from "./edge-config";
import { buildTenantSessionUser, findTenantBySlug, tenantAcceptsLogin } from "./session-user";
import { verifyOtp } from "./otp-store";
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
        if (!verifyOtp(`${tenant.id}:${phone}`, code)) return null;

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
        const { email, password } = parsed.data;

        const platformUser = await platformDb.platformUser.findUnique({ where: { email } });
        if (!platformUser) return null;
        if (!(await verifyPassword(password, platformUser.passwordHash))) return null;

        const sessionUser: PlatformSessionUser = {
          kind: "platform",
          id: platformUser.id,
          name: platformUser.name,
          email: platformUser.email,
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
        const grant = consumeImpersonationToken(parsed.data.token);
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
