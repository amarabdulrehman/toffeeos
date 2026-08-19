import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { deleteTable, updateTable } from "@/server/tables";

// Rename/reseat/move a table — deliberately a stricter permission than status changes (any waiter
// can flip a table to occupied; only a manager reconfigures the floor plan itself).
const updateSchema = z.object({
  label: z.string().min(1).max(40).optional(),
  seats: z.number().int().positive().max(50).optional(),
  floorId: z.string().min(1).optional(),
});

export const PATCH = defineHandler(
  { permission: "tables.manage", input: updateSchema },
  async ({ session, params, input }) => {
    const table = await updateTable(session.tenantId, params.tableId, input);
    return { table };
  }
);

export const DELETE = defineHandler({ permission: "tables.manage" }, async ({ session, params }) => {
  await deleteTable(session.tenantId, params.tableId);
  return { ok: true };
});
