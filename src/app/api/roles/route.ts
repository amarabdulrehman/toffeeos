import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createRole, listRoles } from "@/server/roles";

// GET /api/roles — every role and what it allows, for the roles editor.
export const GET = defineHandler({ permission: "staff.roles.manage" }, async ({ session }) => {
  return { roles: await listRoles(session.tenantId) };
});

const createSchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(z.string()).max(200),
});

// POST /api/roles — a role of the owner's own, e.g. "Shift supervisor".
export const POST = defineHandler(
  {
    permission: "staff.roles.manage",
    input: createSchema,
    audit: (input) => ({ action: "role.create", entityType: "Role", metadata: { name: input.name, permissions: input.permissions } }),
  },
  async ({ session, input }) => {
    const role = await createRole(session.tenantId, input);
    return { role };
  }
);
