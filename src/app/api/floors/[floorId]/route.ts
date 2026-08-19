import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { deleteFloor, renameFloor } from "@/server/tables";

const schema = z.object({ name: z.string().min(1).max(80) });

export const PATCH = defineHandler({ permission: "tables.manage", input: schema }, async ({ session, params, input }) => {
  const floor = await renameFloor(session.tenantId, params.floorId, input.name);
  return { floor };
});

export const DELETE = defineHandler({ permission: "tables.manage" }, async ({ session, params }) => {
  await deleteFloor(session.tenantId, params.floorId);
  return { ok: true };
});
