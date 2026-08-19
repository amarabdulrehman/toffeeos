import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createTable } from "@/server/tables";

// GET /api/tables — floor + table layout for the current branch, used by the POS dine-in table
// picker and the Tables settings screen.
export const GET = defineHandler({ permission: "tables.view" }, async ({ session, db }) => {
  const floors = await db.floor.findMany({
    where: { branchId: session.branchId },
    orderBy: { sortOrder: "asc" },
    include: { tables: { orderBy: { label: "asc" } } },
  });
  return { floors };
});

const createSchema = z.object({
  floorId: z.string().min(1),
  label: z.string().min(1).max(40),
  seats: z.number().int().positive().max(50),
});

export const POST = defineHandler(
  { permission: "tables.manage", input: createSchema },
  async ({ session, input }) => {
    const table = await createTable(session.tenantId, session.branchId, input);
    return { table };
  }
);
