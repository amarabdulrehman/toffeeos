import "server-only";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { newId } from "@/lib/ids";
import { HttpError } from "@/server/handler";
import { generateTempPassword, hashPassword } from "@/lib/password";

export interface CreateRiderInput {
  name: string;
  phone: string;
  employeeId?: string;
}

/** The digits a rider's phone is matched on at sign-in, so "0300-1234567", "03001234567" and
 * "+92 300 1234567" are the same rider. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("92") && digits.length === 12 ? `0${digits.slice(2)}` : digits;
}

/** Every user in the restaurant whose phone matches, with their rider membership if they have one. */
async function usersWithPhone(tenantId: string, phone: string) {
  const key = phoneKey(phone);
  const users = await tenantDb(tenantId).user.findMany({
    where: { phone: { not: null } },
    include: { memberships: { where: { role: { key: "rider" } }, orderBy: { createdAt: "asc" } } },
  });
  return users.filter((u) => u.phone && phoneKey(u.phone) === key);
}

/** A rider is a User with the seeded "rider" role — reuses the whole Phase 1 auth/permission
 * system rather than a parallel Rider model.
 *
 * Riders sign in with the restaurant code, their phone number and a password. Phone codes (OTP)
 * can't be sent in production — there is no SMS sender — so a rider added here used to have no way
 * in at all. The password is generated here and returned once, for the manager to give the rider;
 * only its hash is kept. "Reset password" on the Riders screen issues a new one. */
export async function createRider(tenantId: string, branchId: string, input: CreateRiderInput) {
  const db = tenantDb(tenantId);
  if (phoneKey(input.phone).length < 7) throw new HttpError(400, "That doesn't look like a phone number.");
  // Sign-in finds the rider by phone, so two people on one number would be ambiguous.
  if ((await usersWithPhone(tenantId, input.phone)).length > 0) {
    throw new HttpError(409, "Someone on your staff already uses this phone number.");
  }
  const riderRole = await db.role.findFirstOrThrow({ where: { key: "rider" } });
  const userId = newId();
  const password = generateTempPassword(8);
  const passwordHash = await hashPassword(password);

  const rider = await runInTenantTransaction(tenantId, async (tx) => {
    const user = await tx.user.create({
      data: {
        id: userId,
        tenantId,
        name: input.name,
        phone: input.phone,
        employeeId: input.employeeId,
        passwordHash,
        isActive: true,
      },
    });
    await tx.membership.create({
      data: { tenantId, userId: user.id, branchId, roleId: riderRole.id, isActive: true },
    });
    return user;
  });
  return { rider: { id: rider.id, name: rider.name, phone: rider.phone }, password };
}

/** A new password for a rider on this branch, returned once. Signs them out everywhere, so a lost
 * phone stops working the moment the manager resets it. */
export async function resetRiderPassword(tenantId: string, branchId: string, riderUserId: string) {
  const membership = await tenantDb(tenantId).membership.findFirst({
    where: { branchId, userId: riderUserId, role: { key: "rider" } },
  });
  if (!membership) throw new HttpError(404, "That rider isn't on this branch.");
  const password = generateTempPassword(8);
  const passwordHash = await hashPassword(password);
  await runInTenantTransaction(tenantId, (tx) =>
    tx.user.update({ where: { id: riderUserId }, data: { passwordHash, sessionsValidFrom: new Date() } })
  );
  return { password };
}

/** The rider signing in with this phone, if exactly one active rider has it: their user id and the
 * branch to open. */
export async function findRiderForSignIn(tenantId: string, phone: string) {
  const matches = (await usersWithPhone(tenantId, phone)).filter(
    (u) => u.isActive && u.passwordHash && u.memberships.some((m) => m.isActive)
  );
  if (matches.length !== 1) return null;
  const user = matches[0];
  const membership = user.memberships.find((m) => m.isActive)!;
  return { userId: user.id, passwordHash: user.passwordHash!, branchId: membership.branchId };
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
  return runInTenantTransaction(tenantId, async (tx) => {
    const updated = await tx.membership.update({ where: { id: membership.id }, data: { isActive } });
    // Deactivating has to end the rider's session too; it is only checked at sign-in otherwise.
    if (!isActive) await tx.user.update({ where: { id: riderUserId }, data: { sessionsValidFrom: new Date() } });
    return updated;
  });
}
