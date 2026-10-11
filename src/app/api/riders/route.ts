import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createRider, listRiders } from "@/server/riders";

export const GET = defineHandler({ permission: "delivery.view" }, async ({ session }) => {
  const riders = await listRiders(session.tenantId, session.branchId);
  return { riders };
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(1).max(30),
  employeeId: z.string().max(60).optional(),
});

export const POST = defineHandler(
  { permission: "delivery.manageRiders", input: createSchema },
  async ({ session, input }) => {
    // The password comes back this once, for the manager to hand to the rider.
    return createRider(session.tenantId, session.branchId, input);
  }
);
