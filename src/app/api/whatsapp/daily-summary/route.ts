import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { sendDailySummaryForAllBranches } from "@/server/whatsapp/triggers";

const bodySchema = z.object({ date: z.string().datetime().optional() });

// POST /api/whatsapp/daily-summary — manual "send now" for testing/on-demand use, tenant-scoped
// to the caller's own session. The real scheduled job is /api/cron/daily-summary, which runs
// across every tenant on an external cron trigger.
export const POST = defineHandler({ permission: "whatsapp.manage", input: bodySchema }, async ({ session, input }) => {
  const results = await sendDailySummaryForAllBranches(session.tenantId, input.date ? new Date(input.date) : undefined);
  return { results };
});
