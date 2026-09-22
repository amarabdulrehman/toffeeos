import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getSettings, updateSettings } from "@/server/whatsapp/settings";
import { env } from "@/lib/env";

export const GET = defineHandler({ permission: "whatsapp.manage" }, async ({ session }) => {
  const settings = await getSettings(session.tenantId);
  // Whether the platform itself can send is a server fact the screen cannot work out on its own,
  // and it is the difference between "your messages are going out" and "nothing has ever been
  // delivered". A boolean, never the token.
  return { ...settings, providerConfigured: !!env.WHATSAPP_ACCESS_TOKEN };
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
