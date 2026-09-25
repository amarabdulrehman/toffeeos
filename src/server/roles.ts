import "server-only";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { isValidPermissionKey } from "@/server/permissions/registry";

/**
 * Editing what each role can do.
 *
 * Until this existed, roles were fixed at signup and changed only by a maintenance script, which is
 * why "Manage roles" sat on the roles list gating nothing. Now an owner can change the standard
 * roles, add their own, and remove ones nobody holds.
 *
 * Three rules keep it from going wrong:
 *
 * - The Owner role can't be edited. It holds every permission, including this one; an owner who
 *   removed "Manage roles" from it would have no way back.
 * - Editing a standard role makes it the owner's own (isSystem false). The maintenance script that
 *   re-syncs standard roles to the product's defaults skips those, so it can never quietly undo
 *   an owner's decision.
 * - A permission change reaches someone the next time they sign in, because a session carries its
 *   permissions from sign-in. `signOutNow` applies it at once instead, by ending the sessions of
 *   everyone holding the role — right for taking a permission away, disruptive mid-service, so it
 *   is the owner's choice, not the default.
 */

const OWNER_KEY = "owner";

export interface RoleView {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  /** Still exactly the product's standard definition. False once an owner has changed it. */
  isStandard: boolean;
  /** Owner: shown, never editable. */
  isLocked: boolean;
  memberCount: number;
}

export async function listRoles(tenantId: string): Promise<RoleView[]> {
  const db = tenantDb(tenantId);
  const [roles, counts] = await Promise.all([
    db.role.findMany({ orderBy: { createdAt: "asc" } }),
    db.membership.groupBy({ by: ["roleId"], where: { isActive: true }, _count: { _all: true } }),
  ]);
  const count = new Map(counts.map((c) => [c.roleId, c._count._all]));
  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    permissions: r.permissions,
    isStandard: r.isSystem,
    isLocked: r.key === OWNER_KEY,
    memberCount: count.get(r.id) ?? 0,
  }));
}

function cleanPermissions(permissions: string[]): string[] {
  const unknown = permissions.filter((p) => !isValidPermissionKey(p));
  if (unknown.length > 0) throw new HttpError(400, `Unknown permission: ${unknown.join(", ")}`);
  return [...new Set(permissions)].sort();
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length < 2) throw new HttpError(400, "Give the role a name.");
  if (n.length > 60) throw new HttpError(400, "Keep the name under 60 characters.");
  return n;
}

async function assertNameFree(tenantId: string, name: string, exceptId?: string) {
  const roles = await tenantDb(tenantId).role.findMany({ select: { id: true, name: true } });
  if (roles.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, `There is already a role called "${name}".`);
  }
}

export async function createRole(tenantId: string, input: { name: string; permissions: string[] }) {
  const name = cleanName(input.name);
  await assertNameFree(tenantId, name);
  const permissions = cleanPermissions(input.permissions);
  // A key that can never collide with a standard role's: those are plain words.
  const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}_${Date.now().toString(36)}`;
  return tenantDb(tenantId).role.create({ data: { tenantId, key, name, permissions, isSystem: false } });
}

export async function updateRole(
  tenantId: string,
  roleId: string,
  input: { name?: string; permissions?: string[]; signOutNow?: boolean }
) {
  const db = tenantDb(tenantId);
  const role = await db.role.findFirst({ where: { id: roleId } });
  if (!role) throw new HttpError(404, "That role doesn't exist.");
  if (role.key === OWNER_KEY) throw new HttpError(400, "The Owner role always has every permission, so it can't be changed.");

  const name = input.name !== undefined ? cleanName(input.name) : undefined;
  if (name) await assertNameFree(tenantId, name, role.id);
  const permissions = input.permissions !== undefined ? cleanPermissions(input.permissions) : undefined;

  return runInTenantTransaction(tenantId, async (tx) => {
    const updated = await tx.role.update({
      where: { id: role.id },
      data: {
        ...(name ? { name } : {}),
        ...(permissions ? { permissions } : {}),
        // An owner's decision now — see the note at the top of this file.
        isSystem: false,
      },
    });
    let signedOut = 0;
    if (input.signOutNow && permissions) {
      const members = await tx.membership.findMany({ where: { roleId: role.id }, select: { userId: true } });
      const userIds = [...new Set(members.map((m) => m.userId))];
      if (userIds.length > 0) {
        const res = await tx.user.updateMany({ where: { id: { in: userIds } }, data: { sessionsValidFrom: new Date() } });
        signedOut = res.count;
      }
    }
    return { role: updated, signedOut };
  });
}

export async function deleteRole(tenantId: string, roleId: string) {
  const db = tenantDb(tenantId);
  const role = await db.role.findFirst({ where: { id: roleId } });
  if (!role) throw new HttpError(404, "That role doesn't exist.");
  if (role.key === OWNER_KEY) throw new HttpError(400, "The Owner role can't be removed.");
  const [members, pending, used] = await Promise.all([
    db.membership.count({ where: { roleId: role.id } }),
    db.invite.count({ where: { roleId: role.id, acceptedAt: null } }),
    db.invite.count({ where: { roleId: role.id, acceptedAt: { not: null } } }),
  ]);
  if (members > 0) throw new HttpError(409, `${members} ${members === 1 ? "person has" : "people have"} this role. Give them another role first.`);
  if (pending > 0) throw new HttpError(409, "An invite is waiting with this role. Revoke it first.");
  // Accepted invites are the record of who joined as what; that history stays, so the role does too.
  if (used > 0) throw new HttpError(409, "People have joined with this role before, so it stays on record. Rename it or clear its permissions instead.");
  await db.role.delete({ where: { id: role.id } });
}
