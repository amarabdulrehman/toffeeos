import "server-only";
import { tenantDb } from "@/server/db";
import { findTenantBySlug, tenantAcceptsLogin } from "@/server/auth/session-user";
import { findOrCreateCustomer } from "@/server/crm";
import { createOrder, sendToKitchen, type CreateOrderLineInput } from "@/server/orders";
import { HttpError } from "@/server/handler";

/** Resolves a public storefront by slug — 404s (returns null) rather than leaking whether a slug
 * exists if the tenant is suspended/cancelled, same gate as tenant login. */
export async function getStorefront(slug: string) {
  const tenant = await findTenantBySlug(slug);
  if (!tenant || !tenantAcceptsLogin(tenant.status)) return null;

  const db = tenantDb(tenant.id);
  const branches = await db.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, address: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logoUrl,
    brandColor: tenant.brandColor,
    branches,
  };
}

/** Same shape and the same live availability/pricing data as the POS product grid (GET
 * /api/menu) — a customer ordering online must see the identical "86'd" state a cashier sees,
 * not a stale or separately-maintained copy. */
export async function getPublicMenu(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: {
          variants: { orderBy: { sortOrder: "asc" } },
          modifierGroups: { include: { group: { include: { modifiers: true } } } },
          branchMenuItems: { where: { branchId } },
        },
      },
    },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: c.items.map((item) => {
      const override = item.branchMenuItems[0];
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        basePricePaisa: override?.priceOverridePaisa ?? item.basePricePaisa,
        isAvailable: override?.isAvailable ?? true,
        allergens: item.allergens,
        variants: item.variants.map((v) => ({ id: v.id, name: v.name, priceDeltaPaisa: v.priceDeltaPaisa, isDefault: v.isDefault })),
        modifierGroups: item.modifierGroups.map((mig) => ({
          id: mig.group.id,
          name: mig.group.name,
          minSelect: mig.group.minSelect,
          maxSelect: mig.group.maxSelect,
          modifiers: mig.group.modifiers.map((m) => ({ id: m.id, name: m.name, priceDeltaPaisa: m.priceDeltaPaisa })),
        })),
      };
    }),
  }));
}

export interface PlaceOnlineOrderInput {
  branchId: string;
  customerName: string;
  customerPhone: string;
  fulfillment: "PICKUP" | "DELIVERY";
  deliveryAddress?: string;
  lines: CreateOrderLineInput[];
  idempotencyKey: string;
}

/**
 * Create-and-send in one step, unlike the POS flow's separate "punch then send to kitchen" —
 * there's no staff gesture to split those two steps for a customer checking out online. Lands in
 * the exact same Order Queue / KDS the POS uses (createOrder + sendToKitchen are the same
 * functions, just with actorId=null and source="ONLINE" so staff can see where it came from), and
 * creates/matches a CRM customer by phone the same way a POS phone-lookup does.
 */
export async function placeOnlineOrder(tenantId: string, input: PlaceOnlineOrderInput) {
  if (input.fulfillment === "DELIVERY" && !input.deliveryAddress?.trim()) {
    throw new HttpError(400, "A delivery address is required for delivery orders.");
  }

  const customer = await findOrCreateCustomer(tenantId, input.customerPhone, input.customerName);

  const order = await createOrder(tenantId, input.branchId, null, {
    type: input.fulfillment === "DELIVERY" ? "DELIVERY" : "TAKEAWAY",
    customerId: customer.id,
    lines: input.lines,
    idempotencyKey: input.idempotencyKey,
    source: "ONLINE",
    deliveryAddress: input.fulfillment === "DELIVERY" ? input.deliveryAddress : undefined,
  });

  await sendToKitchen(tenantId, input.branchId, order.id, null);

  return order;
}

export interface UpdateBrandingInput {
  logoUrl?: string | null;
  brandColor?: string | null;
}

export async function updateBranding(tenantId: string, input: UpdateBrandingInput) {
  const db = tenantDb(tenantId);
  return db.tenant.update({ where: { id: tenantId }, data: input });
}
