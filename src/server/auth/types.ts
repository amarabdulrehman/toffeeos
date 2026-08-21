export interface TenantSessionUser {
  kind: "tenant";
  id: string;
  name: string;
  email: string | null;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  membershipId: string;
  roleId: string;
  roleKey: string;
  permissions: string[];
  /** True only for an admin-provisioned owner who hasn't set their own password yet — gates every
   * tenant layout to /change-password until cleared. Never true for self-serve signup or
   * invite-accepted staff, since both of those already chose their own password. */
  mustChangePassword: boolean;
  /** Set only when this session came from the platform admin's Impersonate action — drives the
   * "Viewing as..." banner in the tenant app shell. Absent for a normal staff login. */
  impersonatedByPlatformUserId?: string;
  impersonatedByPlatformUserEmail?: string;
}

export interface PlatformSessionUser {
  kind: "platform";
  id: string;
  name: string;
  email: string;
}

export type SessionUser = TenantSessionUser | PlatformSessionUser;

// Likewise "next-auth"'s Session is a re-export of @auth/core/types' Session, not a locally
// declared interface — augment the real defining module.
declare module "@auth/core/types" {
  interface Session {
    user: SessionUser;
  }
}

// next-auth/jwt.d.ts re-exports @auth/core/jwt via `export *`, which "bundler" module resolution
// won't treat as an augmentation target — augment the underlying module directly instead.
declare module "@auth/core/jwt" {
  interface JWT {
    user?: SessionUser;
  }
}
