import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { updateBranding } from "@/server/online-ordering";

// Branding (logo/color) exists specifically to feed the public online-ordering storefront (see
// Tenant.logoUrl's doc comment in schema.prisma) — gated as an "online" tier feature via
// tierModule, since the permission itself (settings.general.manage) is shared much more broadly
// and isn't itself tier-gated.
export const GET = defineHandler({ permission: "settings.general.manage", tierModule: "online" }, async ({ session, db }) => {
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

export const PATCH = defineHandler(
  { permission: "settings.general.manage", tierModule: "online", input: patchSchema },
  async ({ session, input }) => {
    const tenant = await updateBranding(session.tenantId, input);
    return { tenant };
  }
);
