/**
 * Resolves the effective permission set for one membership (one user at one branch): the role's
 * base permissions, plus per-branch grants, minus per-branch denies. Deny always wins — a manager
 * can hand a normally-privileged staffer extra access, or claw back one specific permission from
 * an otherwise-privileged role, independently of the other.
 */
export interface PermissionContext {
  rolePermissions: readonly string[];
  grants: readonly string[];
  denies: readonly string[];
}

export function resolveEffectivePermissions(ctx: PermissionContext): Set<string> {
  const effective = new Set(ctx.rolePermissions);
  for (const g of ctx.grants) effective.add(g);
  for (const d of ctx.denies) effective.delete(d);
  return effective;
}
