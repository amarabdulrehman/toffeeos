import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { updateBranding } from "@/server/online-ordering";

// Branding started out as an Online Ordering feature and was tier-gated to it. That gate is gone:
// the logo now also prints on receipts (BranchSettings.showLogoOnReceipt), which is core
// point-of-sale, so a Starter client has as much claim to setting one as a Complete client.
// brandColor still only affects the storefront, but it is inert for tenants without it — not worth
// a second route to keep one harmless field gated.
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

export const PATCH = defineHandler(
  { permission: "settings.general.manage", input: patchSchema },
  async ({ session, input }) => {
    const tenant = await updateBranding(session.tenantId, input);
    return { tenant };
  }
);
