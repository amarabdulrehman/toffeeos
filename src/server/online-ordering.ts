import "server-only";
import { tenantDb } from "@/server/db";
import { findTenantBySlug, tenantAcceptsLogin } from "@/server/auth/session-user";
import { findOrCreateCustomer } from "@/server/crm";
import { createOrder, sendToKitchen, findOpenOrderForTable, addLinesToOrder, type CreateOrderLineInput } from "@/server/orders";
import { HttpError } from "@/server/handler";
import { getTenantModules } from "@/server/tier";

/** Resolves a public storefront by slug — 404s (returns null) rather than leaking whether a slug
 * exists if the tenant is suspended/cancelled, same gate as tenant login. Online Ordering + QR
 * Table Ordering is a gateable module: every route under /api/online-order/[tenantSlug]/*
 * (storefront, menu, checkout, qr-checkout, table info) calls this first, so gating it here blocks
 * the whole public flow in one place rather than four separate ones. */
export async function getStorefront(slug: string) {
  const tenant = await findTenantBySlug(slug);
  if (!tenant || !tenantAcceptsLogin(tenant.status)) return null;

  const db = tenantDb(tenant.id);
  const enabledModules = await getTenantModules(db);
  if (!enabledModules.includes("online")) return null;

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
    // Same tie-break as the POS menu: a storefront whose sections shuffle between visits looks broken.
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      items: {
        // isAvailableOnline: an owner can keep a dish off the online and QR menus (online.menu.manage).
        where: { isActive: true, isAvailableOnline: true },
        orderBy: { name: "asc" },
        include: {
          variants: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
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
/**
 * Refuses an item the owner has kept off the online menu. The menu the customer sees already hides
 * it; this is for a stale page, or a request made by hand, which would otherwise order it anyway.
 */
async function assertAllOnline(tenantId: string, lines: { menuItemId: string }[]) {
  const ids = [...new Set(lines.map((l) => l.menuItemId))];
  const removed = await tenantDb(tenantId).menuItem.findMany({
    where: { id: { in: ids }, isActive: false },
    select: { name: true },
  });
  if (removed.length > 0) {
    throw new HttpError(400, `${removed.map((h) => h.name).join(", ")} is no longer on the menu. Please refresh the page.`);
  }
  const hidden = await tenantDb(tenantId).menuItem.findMany({
    where: { id: { in: ids }, isAvailableOnline: false },
    select: { name: true },
  });
  if (hidden.length > 0) {
    throw new HttpError(400, `${hidden.map((h) => h.name).join(", ")} can't be ordered online. Please order it at the counter.`);
  }
}

export async function placeOnlineOrder(tenantId: string, input: PlaceOnlineOrderInput) {
  if (input.fulfillment === "DELIVERY" && !input.deliveryAddress?.trim()) {
    throw new HttpError(400, "A delivery address is required for delivery orders.");
  }
  await assertAllOnline(tenantId, input.lines);

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

/** Resolves a scanned table QR — 404s (returns null) if the table doesn't belong to this tenant,
 * so a stale/tampered tableId in the URL can't leak or target another tenant's table. */
export async function getTableInfo(tenantId: string, tableId: string) {
  const db = tenantDb(tenantId);
  const table = await db.restaurantTable.findUnique({ where: { id: tableId }, include: { floor: true } });
  if (!table) return null;
  return { id: table.id, label: table.label, branchId: table.branchId, floorName: table.floor.name };
}

export interface PlaceQrOrderInput {
  tableId: string;
  customerName?: string;
  customerPhone?: string;
  lines: CreateOrderLineInput[];
  idempotencyKey: string;
}

/**
 * The QR table-ordering flow: reuses the same createOrder/addLinesToOrder/sendToKitchen machinery
 * as everything else (per the brief — no separate ordering engine), just deciding which of the two
 * to call. A guest scanning a table that already has an open order (a waiter started one, or an
 * earlier scan from the same table) gets their items appended to it rather than starting a second,
 * competing order — that's exactly the scenario the offline-sync module's TABLE_DOUBLE_ORDER
 * conflict guards against, so checking first here is what keeps this path from ever tripping it.
 * Unlike online pickup/delivery, name/phone are optional — a dine-in guest is already physically
 * at the table.
 */
export async function placeQrOrder(tenantId: string, input: PlaceQrOrderInput) {
  await assertAllOnline(tenantId, input.lines);
  const db = tenantDb(tenantId);
  const table = await db.restaurantTable.findUniqueOrThrow({ where: { id: input.tableId } });

  let customerId: string | undefined;
  if (input.customerPhone?.trim()) {
    const customer = await findOrCreateCustomer(tenantId, input.customerPhone, input.customerName);
    customerId = customer.id;
  }

  const existing = await findOpenOrderForTable(tenantId, input.tableId);
  if (existing) {
    return addLinesToOrder(tenantId, table.branchId, existing.id, input.lines, null);
  }

  const order = await createOrder(tenantId, table.branchId, null, {
    type: "DINE_IN",
    tableId: input.tableId,
    customerId,
    lines: input.lines,
    idempotencyKey: input.idempotencyKey,
    source: "QR",
  });
  await sendToKitchen(tenantId, table.branchId, order.id, null);
  return order;
}

export interface UpdateBrandingInput {
  logoUrl?: string | null;
  brandColor?: string | null;
}

export async function updateBranding(tenantId: string, input: UpdateBrandingInput) {
  const db = tenantDb(tenantId);

  const before = await db.tenant.findUnique({ where: { id: tenantId }, select: { logoUrl: true } });
  const tenant = await db.tenant.update({ where: { id: tenantId }, data: input });

  /**
   * Setting a logo for the first time switches it on for receipts.
   *
   * BranchSettings.showLogoOnReceipt defaults to false, which was right when the field was added —
   * no existing client's receipts should change underneath them. But it left a dead end: a client
   * uploads their logo, sees it on the storefront, prints a receipt, and it is not there, with no
   * indication why. Uploading a logo is an unambiguous statement that you want it used.
   *
   * Deliberately only on the transition from no-logo to logo, never on a replacement. Before that
   * moment the flag being false cannot have been a decision — there was no logo for it to suppress
   * — so switching it on fills in an unmade choice rather than overruling a made one. Once a client
   * has a logo, turning it off per branch is theirs to do and a later logo change will not undo it.
   */
  const gainedFirstLogo = !before?.logoUrl && !!tenant.logoUrl;
  if (gainedFirstLogo) {
    await db.branchSettings.updateMany({
      where: { showLogoOnReceipt: false },
      data: { showLogoOnReceipt: true },
    });
  }

  return tenant;
}
