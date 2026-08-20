import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { updateBranding } from "@/server/online-ordering";

export const GET = defineHandler({ permission: "settings.general.manage" }, async ({ session, db }) => {
  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: { slug: true, name: true, logoUrl: true, brandColor: true },
  });
  return tenant;
});

const patchSchema = z.object({
  logoUrl: z.string().url().max(500).nullable().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

export const PATCH = defineHandler({ permission: "settings.general.manage", input: patchSchema }, async ({ session, input }) => {
  const tenant = await updateBranding(session.tenantId, input);
  return { tenant };
});
