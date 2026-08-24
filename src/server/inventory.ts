import "server-only";
import { runInTenantTransaction, tenantDb, type TenantTransactionClient } from "@/server/db";
import { HttpError } from "@/server/handler";
import { notifyLowStock } from "@/server/whatsapp/triggers";

export async function createLocation(tenantId: string, branchId: string, name: string) {
  const db = tenantDb(tenantId);
  return db.stockLocation.create({ data: { tenantId, branchId, name } });
}

export async function listLocations(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  return db.stockLocation.findMany({ where: { branchId, isActive: true }, orderBy: { name: "asc" } });
}

export interface CreateItemInput {
  name: string;
  unitOfMeasure: string;
  lowStockThresholdQty: number;
}

export async function createItem(tenantId: string, input: CreateItemInput) {
  const db = tenantDb(tenantId);
  return db.inventoryItem.create({ data: { tenantId, ...input } });
}

export async function listItems(tenantId: string) {
  const db = tenantDb(tenantId);
  return db.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

/** Every item × location combination for a branch, including zero-quantity rows for items that
 * have never had stock recorded at that location — the report is meant to show gaps, not hide them. */
export async function stockReport(tenantId: string, branchId: string, opts: { belowThresholdOnly?: boolean } = {}) {
  const db = tenantDb(tenantId);
  const [locations, items] = await Promise.all([
    db.stockLocation.findMany({ where: { branchId, isActive: true } }),
    db.inventoryItem.findMany({ where: { isActive: true } }),
  ]);
  const levels = await db.stockLevel.findMany({
    where: { locationId: { in: locations.map((l) => l.id) } },
  });
  // Rounded defensively at read time too, for StockLevel rows written before the rounding fix in
  // applyStockDelta landed — old rows can still carry accumulated float drift (e.g. -2.8e-15).
  const levelByKey = new Map(levels.map((l) => [`${l.locationId}:${l.itemId}`, Math.round(l.quantity * 1000) / 1000]));

  const rows = locations.flatMap((location) =>
    items.map((item) => ({
      locationId: location.id,
      locationName: location.name,
      itemId: item.id,
      itemName: item.name,
      unitOfMeasure: item.unitOfMeasure,
      quantity: levelByKey.get(`${location.id}:${item.id}`) ?? 0,
      thresholdQty: item.lowStockThresholdQty,
      belowThreshold: (levelByKey.get(`${location.id}:${item.id}`) ?? 0) < item.lowStockThresholdQty,
    }))
  );

  return opts.belowThresholdOnly ? rows.filter((r) => r.belowThreshold) : rows;
}

export interface NewLowStockAlert {
  itemId: string;
  itemName: string;
  unitOfMeasure: string;
  locationId: string;
  branchId: string;
  quantityAtTrigger: number;
  thresholdAtTrigger: number;
}

/** Upserts the StockLevel row and, if the resulting quantity crosses the item's threshold in
 * either direction, opens or resolves a LowStockAlert. Called from inside the same transaction as
 * the StockMovement write so the cache and the ledger never drift apart. Exported so
 * src/server/recipes.ts can reuse it for recipe-consumption deductions instead of re-implementing
 * the StockLevel/LowStockAlert bookkeeping.
 *
 * Returns `newAlert` (non-null only when an alert was newly opened, not on every call while an
 * alert stays active) so callers can fire the WhatsApp low-stock notification exactly once per
 * threshold crossing, after their own transaction commits — never from inside this function, since
 * a WhatsApp send is not something a stock-level write should ever roll back for. */
export async function applyStockDelta(
  tx: TenantTransactionClient,
  tenantId: string,
  branchId: string,
  locationId: string,
  itemId: string,
  delta: number
): Promise<{ level: Awaited<ReturnType<TenantTransactionClient["stockLevel"]["upsert"]>>; newAlert: NewLowStockAlert | null }> {
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId, tenantId } });
  let level = await tx.stockLevel.upsert({
    where: { locationId_itemId: { locationId, itemId }, tenantId },
    create: { tenantId, locationId, itemId, quantity: delta },
    update: { quantity: { increment: delta } },
  });

  // Float increments accumulate floating-point drift over many recipe-consumption deductions
  // (e.g. a quantity that should be exactly 0 lands at -2.8e-15). Snap to a sane precision right
  // after every write so the drift never compounds and never surfaces in the UI as scientific
  // notation.
  const rounded = Math.round(level.quantity * 1000) / 1000;
  if (rounded !== level.quantity) {
    level = await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: rounded } });
  }

  const isBelow = level.quantity < item.lowStockThresholdQty;
  const activeAlert = await tx.lowStockAlert.findFirst({
    where: { tenantId, itemId, locationId, status: "ACTIVE" },
  });

  let newAlert: NewLowStockAlert | null = null;
  if (isBelow && !activeAlert) {
    await tx.lowStockAlert.create({
      data: {
        tenantId,
        branchId,
        itemId,
        locationId,
        quantityAtTrigger: level.quantity,
        thresholdAtTrigger: item.lowStockThresholdQty,
      },
    });
    newAlert = {
      itemId,
      itemName: item.name,
      unitOfMeasure: item.unitOfMeasure,
      locationId,
      branchId,
      quantityAtTrigger: level.quantity,
      thresholdAtTrigger: item.lowStockThresholdQty,
    };
  } else if (!isBelow && activeAlert) {
    await tx.lowStockAlert.update({
      where: { id: activeAlert.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  return { level, newAlert };
}

export interface RecordGrnInput {
  locationId: string;
  itemId: string;
  quantity: number;
  costPaisa?: number;
  supplierName?: string;
}

export async function recordGrn(tenantId: string, branchId: string, actorId: string, input: RecordGrnInput) {
  if (input.quantity <= 0) throw new HttpError(400, "Quantity received must be positive.");
  const { level, newAlert } = await runInTenantTransaction(tenantId, async (tx) => {
    await tx.stockMovement.create({
      data: {
        tenantId,
        branchId,
        itemId: input.itemId,
        locationId: input.locationId,
        type: "GRN",
        quantityDelta: input.quantity,
        costPaisa: input.costPaisa,
        supplierName: input.supplierName,
        actorId,
      },
    });
    return applyStockDelta(tx, tenantId, branchId, input.locationId, input.itemId, input.quantity);
  });
  if (newAlert) await notifyLowStock(tenantId, newAlert);
  return level;
}

export interface RecordAdjustmentInput {
  locationId: string;
  itemId: string;
  quantityDelta: number;
  reason: string;
}

/// Reason is required (not optional) at the type level — this is the one place shrinkage/theft
/// could otherwise hide, so the API layer must never accept an adjustment without one.
export async function recordAdjustment(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: RecordAdjustmentInput
) {
  if (!input.reason.trim()) throw new HttpError(400, "A reason is required for stock adjustments.");
  if (input.quantityDelta === 0) throw new HttpError(400, "Adjustment quantity cannot be zero.");
  const { level, newAlert } = await runInTenantTransaction(tenantId, async (tx) => {
    await tx.stockMovement.create({
      data: {
        tenantId,
        branchId,
        itemId: input.itemId,
        locationId: input.locationId,
        type: "ADJUSTMENT",
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        actorId,
      },
    });
    return applyStockDelta(tx, tenantId, branchId, input.locationId, input.itemId, input.quantityDelta);
  });
  if (newAlert) await notifyLowStock(tenantId, newAlert);
  return level;
}

export interface RecordTransferInput {
  fromLocationId: string;
  toLocationId: string;
  itemId: string;
  quantity: number;
}

/** Locations may belong to different branches of the same tenant (multi-branch transfer) — each
 * side's StockMovement row is stamped with ITS OWN location's branchId, not a single shared one. */
export async function recordTransfer(tenantId: string, actorId: string, input: RecordTransferInput) {
  if (input.quantity <= 0) throw new HttpError(400, "Transfer quantity must be positive.");
  if (input.fromLocationId === input.toLocationId) throw new HttpError(400, "Source and destination must differ.");

  const result = await runInTenantTransaction(tenantId, async (tx) => {
    const [fromLocation, toLocation] = await Promise.all([
      tx.stockLocation.findUniqueOrThrow({ where: { id: input.fromLocationId, tenantId } }),
      tx.stockLocation.findUniqueOrThrow({ where: { id: input.toLocationId, tenantId } }),
    ]);

    const existing = await tx.stockLevel.findUnique({
      where: { locationId_itemId: { locationId: input.fromLocationId, itemId: input.itemId }, tenantId },
    });
    if (!existing || existing.quantity < input.quantity) {
      throw new HttpError(400, "Not enough stock at the source location for this transfer.");
    }

    const transferGroupId = crypto.randomUUID();

    await tx.stockMovement.create({
      data: {
        tenantId,
        branchId: fromLocation.branchId,
        itemId: input.itemId,
        locationId: input.fromLocationId,
        type: "TRANSFER_OUT",
        quantityDelta: -input.quantity,
        transferGroupId,
        actorId,
      },
    });
    await tx.stockMovement.create({
      data: {
        tenantId,
        branchId: toLocation.branchId,
        itemId: input.itemId,
        locationId: input.toLocationId,
        type: "TRANSFER_IN",
        quantityDelta: input.quantity,
        transferGroupId,
        actorId,
      },
    });

    const [from, to] = await Promise.all([
      applyStockDelta(tx, tenantId, fromLocation.branchId, input.fromLocationId, input.itemId, -input.quantity),
      applyStockDelta(tx, tenantId, toLocation.branchId, input.toLocationId, input.itemId, input.quantity),
    ]);
    return { fromLevel: from.level, toLevel: to.level, transferGroupId, newAlerts: [from.newAlert, to.newAlert].filter((a) => a !== null) };
  });
  await Promise.all(result.newAlerts.map((alert) => notifyLowStock(tenantId, alert)));
  return result;
}

export async function listActiveLowStockAlerts(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  return db.lowStockAlert.findMany({
    where: { branchId, status: "ACTIVE" },
    include: { item: true, location: true },
    orderBy: { createdAt: "desc" },
  });
}
