import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { setRiderActive } from "@/server/riders";

const schema = z.object({ isActive: z.boolean() });

export const PATCH = defineHandler(
  { permission: "delivery.manageRiders", input: schema },
  async ({ session, params, input }) => {
    const membership = await setRiderActive(session.tenantId, session.branchId, params.riderId, input.isActive);
    return { membership };
  }
);
