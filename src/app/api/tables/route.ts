import { defineHandler } from "@/server/handler";

// GET /api/tables — floor + table layout for the current branch, used by the POS dine-in table
// picker and the (future, Phase 2) floor-plan screen.
export const GET = defineHandler({ permission: "tables.view" }, async ({ session, db }) => {
  const floors = await db.floor.findMany({
    where: { branchId: session.branchId },
    orderBy: { sortOrder: "asc" },
    include: { tables: { orderBy: { label: "asc" } } },
  });
  return { floors };
});
