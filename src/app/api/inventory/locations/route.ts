import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createLocation, listLocations } from "@/server/inventory";

export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  const locations = await listLocations(session.tenantId, session.branchId);
  return { locations };
});

const schema = z.object({ name: z.string().min(1).max(80) });

export const POST = defineHandler({ permission: "inventory.location.manage", input: schema }, async ({ session, input }) => {
  const location = await createLocation(session.tenantId, session.branchId, input.name);
  return { location };
});
