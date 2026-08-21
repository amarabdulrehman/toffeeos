import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";

const schema = z.object({ isActive: z.boolean() });

// PATCH /api/staff/members/[id] — deactivate/reactivate a staff member's membership at this branch.
// [id] is the Membership id, not the User id — a person can (in principle) hold more than one
// membership, and it's the membership (their access at a given branch) being toggled, not the person.
// No DELETE here on purpose — deactivating preserves order/audit history a hard delete would orphan.
export const PATCH = defineHandler(
  {
    permission: "staff.manage",
    input: schema,
    audit: (input) => ({
      action: input.isActive ? "staff.member.reactivate" : "staff.member.deactivate",
      entityType: "Membership",
    }),
  },
  async ({ session, db, params, input }) => {
    const membership = await db.membership.findFirst({ where: { id: params.id, tenantId: session.tenantId } });
    if (!membership) throw new HttpError(404, "Not found");
    if (membership.userId === session.id) throw new HttpError(400, "You can't deactivate your own account.");

    await db.membership.update({ where: { id: params.id }, data: { isActive: input.isActive } });
    return { ok: true };
  }
);
