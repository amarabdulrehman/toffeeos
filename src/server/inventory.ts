import "server-only";
import { runInTenantTransaction, tenantDb, type TenantTransactionClient } from "@/server/db";
import { HttpError } from "@/server/handler";

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
  const levelByKey = new Map(levels.map((l) => [`${l.locationId}:${l.itemId}`, l.quantity]));

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

/** Upserts the StockLevel row and, if the resulting quantity crosses the item's threshold in
 * either direction, opens or resolves a LowStockAlert. Called from inside the same transaction as
 * the StockMovement write so the cache and the ledger never drift apart. */
async function applyDelta(
  tx: TenantTransactionClient,
  tenantId: string,
  branchId: string,
  locationId: string,
  itemId: string,
  delta: number
) {
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId, tenantId } });
  const level = await tx.stockLevel.upsert({
    where: { locationId_itemId: { locationId, itemId }, tenantId },
    create: { tenantId, locationId, itemId, quantity: delta },
    update: { quantity: { increment: delta } },
  });

  const isBelow = level.quantity < item.lowStockThresholdQty;
  const activeAlert = await tx.lowStockAlert.findFirst({
    where: { tenantId, itemId, locationId, status: "ACTIVE" },
  });

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
  } else if (!isBelow && activeAlert) {
    await tx.lowStockAlert.update({
      where: { id: activeAlert.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  return level;
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
  return runInTenantTransaction(tenantId, async (tx) => {
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
    return applyDelta(tx, tenantId, branchId, input.locationId, input.itemId, input.quantity);
  });
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
  return runInTenantTransaction(tenantId, async (tx) => {
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
    return applyDelta(tx, tenantId, branchId, input.locationId, input.itemId, input.quantityDelta);
  });
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

  return runInTenantTransaction(tenantId, async (tx) => {
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

    const [fromLevel, toLevel] = await Promise.all([
      applyDelta(tx, tenantId, fromLocation.branchId, input.fromLocationId, input.itemId, -input.quantity),
      applyDelta(tx, tenantId, toLocation.branchId, input.toLocationId, input.itemId, input.quantity),
    ]);
    return { fromLevel, toLevel, transferGroupId };
  });
}

export async function listActiveLowStockAlerts(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  return db.lowStockAlert.findMany({
    where: { branchId, status: "ACTIVE" },
    include: { item: true, location: true },
    orderBy: { createdAt: "desc" },
  });
}
