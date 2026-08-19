import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { sendWinBackBatch } from "@/server/whatsapp/triggers";

const bodySchema = z.object({ inactiveDays: z.number().int().positive().default(30) });

// POST /api/whatsapp/win-back — a deliberate, owner-triggered send (not a silent cron): reuses
// the Phase 3 "inactive 30+ days" CRM segment, gated per-recipient by opt-out and template approval.
export const POST = defineHandler({ permission: "whatsapp.manage", input: bodySchema }, async ({ session, input }) => {
  return sendWinBackBatch(session.tenantId, input.inactiveDays);
});
