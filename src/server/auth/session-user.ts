import "server-only";
import { rawDb, tenantDb } from "@/server/db";
import { resolveEffectivePermissions } from "@/server/permissions/check";
import type { TenantSessionUser } from "./types";

/** Tenant lookup by slug. Tenant carries no tenantId column of its own, so it has no RLS policy
 * (see the migration) — this is safe to run on rawDb directly. */
export async function findTenantBySlug(slug: string) {
  return rawDb.tenant.findUnique({ where: { slug } });
}

export function tenantAcceptsLogin(status: string): boolean {
  return status === "ACTIVE" || status === "TRIALING";
}

/**
 * Builds the full session payload for a tenant user: resolves (or is given) which branch
 * membership is active, and flattens the role + per-branch grants/denies into one effective
 * permissions list so every downstream check is a single array lookup, not a live re-resolve.
 *
 * `branchId` omitted -> picks the user's oldest active membership (their "default" branch).
 */
export async function buildTenantSessionUser(
  tenantId: string,
  userId: string,
  branchId?: string
): Promise<TenantSessionUser | null> {
  const db = tenantDb(tenantId);

  const [tenant, user] = await Promise.all([
    rawDb.tenant.findUnique({ where: { id: tenantId } }),
    db.user.findUnique({ where: { id: userId } }),
  ]);
  if (!tenant || !user || !user.isActive) return null;

  const membership = await db.membership.findFirst({
    where: { userId, isActive: true, ...(branchId ? { branchId } : {}) },
    include: { role: true, branch: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership || !membership.branch.isActive) return null;

  const permissions = Array.from(
    resolveEffectivePermissions({
      rolePermissions: membership.role.permissions,
      grants: membership.grants,
      denies: membership.denies,
    })
  );

  return {
    kind: "tenant",
    id: user.id,
    name: user.name,
    email: user.email,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    branchId: membership.branchId,
    branchName: membership.branch.name,
    membershipId: membership.id,
    roleId: membership.roleId,
    roleKey: membership.role.key,
    permissions,
    mustChangePassword: user.mustChangePassword,
    // Stamped at issue time; defineHandler compares it against the stored value on every request.
    sessionsValidFrom: user.sessionsValidFrom.getTime(),
  };
}
