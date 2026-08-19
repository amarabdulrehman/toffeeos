import { defineHandler } from "@/server/handler";
import { listMessageLog } from "@/server/whatsapp/send";
import { resolveReportBranchIds } from "@/server/reports";

export const GET = defineHandler({ permission: "whatsapp.manage" }, async ({ session }) => {
  const branchIds = await resolveReportBranchIds(session);
  const messages = await listMessageLog(session.tenantId, branchIds);
  return { messages };
});
