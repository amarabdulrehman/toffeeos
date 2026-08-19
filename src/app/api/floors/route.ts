import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createFloor } from "@/server/tables";

const schema = z.object({ name: z.string().min(1).max(80) });

export const POST = defineHandler({ permission: "tables.manage", input: schema }, async ({ session, input }) => {
  const floor = await createFloor(session.tenantId, session.branchId, input.name);
  return { floor };
});
