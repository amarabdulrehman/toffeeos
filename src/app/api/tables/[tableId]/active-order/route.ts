import { defineHandler } from "@/server/handler";
import { findActiveOrderForTable } from "@/server/tables";

// GET /api/tables/[tableId]/active-order — what tapping an occupied table resumes into.
export const GET = defineHandler({ permission: "tables.view" }, async ({ session, params }) => {
  const order = await findActiveOrderForTable(session.tenantId, params.tableId);
  return { order };
});
