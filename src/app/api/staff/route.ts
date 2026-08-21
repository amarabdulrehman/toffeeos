import { defineHandler } from "@/server/handler";

// GET /api/staff — the whole Staff page's data in one shot: active team members, pending invites,
// and the roles/branches reference data the "invite staff" dialog needs to populate its pickers.
// Bundled rather than three round-trips, same reasoning as the Tables page bundling floors + tenant
// branding into its own fetches kept separate — here everything is small and always needed together.
export const GET = defineHandler({ permission: "staff.manage" }, async ({ session, db }) => {
  const [memberships, invites, roles, branches] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: session.tenantId },
      include: { user: true, role: true, branch: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invite.findMany({
      where: { tenantId: session.tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { role: true, branch: true },
      orderBy: { createdAt: "desc" },
    }),
    db.role.findMany({ where: { tenantId: session.tenantId }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { tenantId: session.tenantId, isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    members: memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      roleId: m.roleId,
      roleName: m.role.name,
      branchId: m.branchId,
      branchName: m.branch.name,
      isActive: m.isActive,
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      roleName: i.role.name,
      branchName: i.branch.name,
      expiresAt: i.expiresAt,
      token: i.token,
    })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, key: r.key })),
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
  };
});
