import { defineHandler, HttpError } from "@/server/handler";
import { uploadTenantLogo } from "@/server/storage";
import { updateBranding } from "@/server/online-ordering";

/**
 * POST /api/tenant-branding/logo — multipart upload of the tenant's logo.
 *
 * Deliberately NOT tier-gated. The sibling /api/tenant-branding route was gated to the Online
 * Ordering module because branding existed only to dress the public storefront; a logo on a printed
 * receipt is core point-of-sale, and a Starter client printing their own receipts has as much claim
 * to it as a Complete one.
 *
 * No `input` schema — defineHandler parses JSON, and this is multipart. Same shape as the delivery
 * proof upload in api/rider/orders/[orderId]/deliver.
 */
export const POST = defineHandler(
  {
    permission: "settings.general.manage",
    audit: () => ({ action: "tenant.logo.upload", entityType: "Tenant" }),
  },
  async ({ session, req }) => {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw new HttpError(400, "Send the logo as multipart/form-data.");
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No logo file was included.");

    let logoUrl: string;
    try {
      logoUrl = await uploadTenantLogo(session.tenantId, file);
    } catch (err) {
      // uploadTenantLogo throws plain Errors for the two cases a user can actually fix (wrong file
      // type, too large) — surface those verbatim rather than as a generic 500.
      throw new HttpError(400, err instanceof Error ? err.message : "Could not upload that logo.");
    }

    await updateBranding(session.tenantId, { logoUrl });
    return { logoUrl };
  }
);
