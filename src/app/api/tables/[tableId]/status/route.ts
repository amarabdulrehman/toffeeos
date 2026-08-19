import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { setTableStatus } from "@/server/tables";

const schema = z.object({ status: z.enum(["AVAILABLE", "RESERVED", "BOOKED", "OCCUPIED"]) });

export const PATCH = defineHandler(
  { permission: "tables.changeStatus", input: schema },
  async ({ session, params, input }) => {
    const table = await setTableStatus(session.tenantId, session.branchId, params.tableId, input.status);
    return { table };
  }
);
