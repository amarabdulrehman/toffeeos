import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getSettings, updateSettings } from "@/server/whatsapp/settings";

export const GET = defineHandler({ permission: "whatsapp.manage" }, async ({ session }) => {
  return getSettings(session.tenantId);
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  lowStockAlertsEnabled: z.boolean().optional(),
  dailySummaryEnabled: z.boolean().optional(),
  winBackEnabled: z.boolean().optional(),
  deliveryUpdatesEnabled: z.boolean().optional(),
  thankYouEnabled: z.boolean().optional(),
  thankYouTrigger: z.enum(["ON_ORDER", "ON_PAYMENT"]).optional(),
  businessPhoneNumberId: z.string().max(120).nullable().optional(),
  businessAccountId: z.string().max(120).nullable().optional(),
});

export const PATCH = defineHandler({ permission: "whatsapp.manage", input: patchSchema }, async ({ session, input }) => {
  return updateSettings(session.tenantId, input);
});
