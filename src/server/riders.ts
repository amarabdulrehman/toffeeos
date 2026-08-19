import "server-only";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { newId } from "@/lib/ids";

export interface CreateRiderInput {
  name: string;
  phone: string;
  employeeId?: string;
}

/** A rider is a User with the seeded "rider" role — reuses the whole Phase 1 auth/permission
 * system (phone+OTP login already exists) rather than a parallel Rider model. */
export async function createRider(tenantId: string, branchId: string, input: CreateRiderInput) {
  const db = tenantDb(tenantId);
  const riderRole = await db.role.findFirstOrThrow({ where: { key: "rider" } });
  const userId = newId();

  return runInTenantTransaction(tenantId, async (tx) => {
    const user = await tx.user.create({
      data: {
        id: userId,
        tenantId,
        name: input.name,
        phone: input.phone,
        employeeId: input.employeeId,
        isActive: true,
      },
    });
    await tx.membership.create({
      data: { tenantId, userId: user.id, branchId, roleId: riderRole.id, isActive: true },
    });
    return user;
  });
}

export async function listRiders(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  const memberships = await db.membership.findMany({
    where: { branchId, role: { key: "rider" } },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  const riderIds = memberships.map((m) => m.userId);
  const activeCounts = await db.order.groupBy({
    by: ["assignedRiderId"],
    where: { branchId, assignedRiderId: { in: riderIds }, deliveredAt: null },
    _count: { _all: true },
  });
  const countByRider = new Map(activeCounts.map((c) => [c.assignedRiderId, c._count._all]));

  return memberships.map((m) => ({
    userId: m.userId,
    membershipId: m.id,
    name: m.user.name,
    phone: m.user.phone,
    employeeId: m.user.employeeId,
    isActive: m.isActive,
    activeDeliveryCount: countByRider.get(m.userId) ?? 0,
  }));
}

export async function setRiderActive(tenantId: string, branchId: string, riderUserId: string, isActive: boolean) {
  const db = tenantDb(tenantId);
  const membership = await db.membership.findFirstOrThrow({ where: { branchId, userId: riderUserId } });
  return db.membership.update({ where: { id: membership.id }, data: { isActive } });
}
