import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { deleteRole, updateRole } from "@/server/roles";

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  permissions: z.array(z.string()).max(200).optional(),
  /** End the sessions of everyone in this role so the change applies now, not at next sign-in. */
  signOutNow: z.boolean().optional(),
});

// PATCH /api/roles/[roleId] — rename a role or change what it allows. Audited with the full new
// permission list: "who gave cashiers refunds?" has to be answerable later.
export const PATCH = defineHandler(
  {
    permission: "staff.roles.manage",
    input: updateSchema,
    audit: (input, result) => ({
      action: "role.update",
      entityType: "Role",
      entityId: (result as { role?: { id: string } }).role?.id,
      metadata: { ...input },
    }),
  },
  async ({ session, params, input }) => {
    return updateRole(session.tenantId, params.roleId, input);
  }
);

// DELETE /api/roles/[roleId] — only a role nobody holds and no invite points at.
export const DELETE = defineHandler(
  {
    permission: "staff.roles.manage",
    audit: () => ({ action: "role.delete", entityType: "Role" }),
  },
  async ({ session, params }) => {
    await deleteRole(session.tenantId, params.roleId);
    return { ok: true };
  }
);
