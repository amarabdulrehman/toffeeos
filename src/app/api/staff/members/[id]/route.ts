import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";

const schema = z
  .object({
    isActive: z.boolean().optional(),
    roleId: z.string().min(1).optional(),
  })
  .refine((v) => v.isActive !== undefined || v.roleId !== undefined, "Nothing to change.");

export const PATCH = defineHandler(
  {
    permission: "staff.manage",
    input: schema,
    audit: (input) => ({
      action:
        input.roleId !== undefined
          ? "staff.member.role"
          : input.isActive
            ? "staff.member.reactivate"
            : "staff.member.deactivate",
      entityType: "Membership",
      metadata: { ...input },
    }),
  },
  async ({ session, db, params, input }) => {
    const membership = await db.membership.findFirst({ where: { id: params.id, tenantId: session.tenantId } });
    if (!membership) throw new HttpError(404, "Not found");
    if (membership.userId === session.id) {
      throw new HttpError(400, input.roleId ? "You can't change your own role." : "You can't deactivate your own account.");
    }

    if (input.roleId !== undefined) {
      // Choosing what someone may do is the roles permission, not general staff management: a
      // branch manager who could hand out roles could hand out Owner.
      if (!session.permissions.includes("staff.roles.manage")) {
        throw new HttpError(403, "Missing permission: staff.roles.manage");
      }
      const role = await db.role.findFirst({ where: { id: input.roleId } });
      if (!role) throw new HttpError(404, "That role doesn't exist.");
      await db.membership.update({ where: { id: params.id }, data: { roleId: role.id } });
      // A session carries its permissions from sign-in, so end theirs: the new role applies at their
      // next tap rather than whenever they happen to sign out.
      await db.user.update({ where: { id: membership.userId }, data: { sessionsValidFrom: new Date() } });
    }

    if (input.isActive !== undefined) {
      await db.membership.update({ where: { id: params.id }, data: { isActive: input.isActive } });
    }
    return { ok: true };
  }
);
