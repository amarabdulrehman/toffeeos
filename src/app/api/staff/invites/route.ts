import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { createInvite } from "@/server/staff-invites";

const schema = z.object({
  branchId: z.string().min(1),
  roleId: z.string().min(1),
  email: z.string().email(),
});

export const POST = defineHandler(
  {
    permission: "staff.invite",
    input: schema,
    audit: (input, result) => ({
      action: "staff.invite.create",
      entityType: "Invite",
      entityId: (result as { id: string }).id,
      metadata: { email: input.email, roleId: input.roleId, branchId: input.branchId },
    }),
  },
  async ({ session, db, input }) => {
    const [role, branch] = await Promise.all([
      db.role.findFirst({ where: { id: input.roleId, tenantId: session.tenantId } }),
      db.branch.findFirst({ where: { id: input.branchId, tenantId: session.tenantId } }),
    ]);
    if (!role || !branch) throw new HttpError(400, "Invalid role or branch.");

    const invite = await createInvite(session.tenantId, db, input);
    return { id: invite.id, token: invite.token };
  }
);
