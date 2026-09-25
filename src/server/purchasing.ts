import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { applyStockDelta, recordTransfer, type NewLowStockAlert } from "@/server/inventory";
import { notifyLowStock } from "@/server/whatsapp/triggers";

/**
 * Buying stock: suppliers, purchase orders, and transfers that need someone else's approval.
 *
 * A purchase order goes DRAFT → APPROVED → RECEIVED, each step its own permission, so the person
 * who orders need not be the person who spends and neither need be the person who counts it in.
 * In a small café one owner holds all three and it is just a record; in a bigger one it is the
 * control. Receiving writes ordinary goods-received movements (with the order's number on them),
 * so stock levels, low-stock alerts and the P&L's stock purchases see a received order exactly as
 * they see stock typed in by hand. What arrived can differ from what was ordered — short deliveries
 * are normal — and it is what arrived that is counted.
 */

// ---------------------------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------------------------

export async function listSuppliers(tenantId: string) {
  return tenantDb(tenantId).supplier.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
}

export async function saveSupplier(
  tenantId: string,
  input: { id?: string; name: string; phone?: string | null; email?: string | null; notes?: string | null; isActive?: boolean }
) {
  const db = tenantDb(tenantId);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new HttpError(400, "Give the supplier a name.");
  const clash = await db.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) },
  });
  if (clash) throw new HttpError(409, `There is already a supplier called "${clash.name}".`);
  const data = {
    name,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  if (input.id) {
    const existing = await db.supplier.findFirst({ where: { id: input.id } });
    if (!existing) throw new HttpError(404, "That supplier doesn't exist.");
    return db.supplier.update({ where: { id: input.id }, data });
  }
  return db.supplier.create({ data: { tenantId, ...data } });
}

// ---------------------------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------------------------

export interface PurchaseOrderLineInput {
  itemId: string;
  quantity: number;
  unitCostPaisa: number;
}

async function validateLines(tenantId: string, lines: PurchaseOrderLineInput[]) {
  if (lines.length === 0) throw new HttpError(400, "Add at least one item to the order.");
  for (const l of lines) {
    if (!(l.quantity > 0)) throw new HttpError(400, "Every quantity has to be more than zero.");
    if (!Number.isInteger(l.unitCostPaisa) || l.unitCostPaisa < 0) throw new HttpError(400, "Costs have to be zero or more.");
  }
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (ids.length !== lines.length) throw new HttpError(400, "An item is listed twice. Put it on one line.");
  const items = await tenantDb(tenantId).inventoryItem.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  if (items.length !== ids.length) throw new HttpError(400, "One of those items doesn't exist or has been archived.");
}

async function assertLocationInBranch(tenantId: string, branchId: string, locationId: string) {
  const location = await tenantDb(tenantId).stockLocation.findFirst({ where: { id: locationId, branchId, isActive: true } });
  if (!location) throw new HttpError(400, "Pick a stock location at this branch for the goods to go to.");
}

export async function listPurchaseOrders(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  const orders = await db.purchaseOrder.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { supplier: { select: { name: true } }, lines: true },
  });
  const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))];
  const userIds = [...new Set(orders.flatMap((o) => [o.createdById, o.approvedById, o.receivedById].filter((v): v is string => !!v)))];
  const [items, users] = await Promise.all([
    itemIds.length ? db.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unitOfMeasure: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const item = new Map(items.map((i) => [i.id, i]));
  const user = new Map(users.map((u) => [u.id, u.name]));
  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    supplierName: o.supplier.name,
    locationId: o.locationId,
    notes: o.notes,
    createdByName: user.get(o.createdById) ?? null,
    approvedByName: o.approvedById ? (user.get(o.approvedById) ?? null) : null,
    receivedByName: o.receivedById ? (user.get(o.receivedById) ?? null) : null,
    createdAt: o.createdAt,
    totalPaisa: o.lines.reduce((s, l) => s + Math.round(l.unitCostPaisa * l.quantity), 0),
    lines: o.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemName: item.get(l.itemId)?.name ?? "Unknown item",
      unit: item.get(l.itemId)?.unitOfMeasure ?? "",
      quantity: l.quantity,
      unitCostPaisa: l.unitCostPaisa,
      receivedQuantity: l.receivedQuantity,
    })),
  }));
}

export async function createPurchaseOrder(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { supplierId: string; locationId: string; notes?: string | null; lines: PurchaseOrderLineInput[] }
) {
  const db = tenantDb(tenantId);
  const supplier = await db.supplier.findFirst({ where: { id: input.supplierId, isActive: true } });
  if (!supplier) throw new HttpError(400, "Pick an active supplier.");
  await assertLocationInBranch(tenantId, branchId, input.locationId);
  await validateLines(tenantId, input.lines);

  // Numbered per branch like orders; the unique constraint settles a race between two people
  // drafting at once, and the loser simply takes the next number.
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await db.purchaseOrder.findFirst({ where: { branchId }, orderBy: { number: "desc" }, select: { number: true } });
    try {
      return await db.purchaseOrder.create({
        data: {
          tenantId,
          branchId,
          supplierId: supplier.id,
          locationId: input.locationId,
          number: (last?.number ?? 0) + 1,
          notes: input.notes?.trim() || null,
          createdById: actorId,
          lines: { create: input.lines.map((l) => ({ tenantId, itemId: l.itemId, quantity: l.quantity, unitCostPaisa: l.unitCostPaisa })) },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new HttpError(409, "Couldn't number the order — please try again.");
}

async function loadPo(tenantId: string, branchId: string, id: string) {
  const po = await tenantDb(tenantId).purchaseOrder.findFirst({ where: { id, branchId }, include: { lines: true, supplier: true } });
  if (!po) throw new HttpError(404, "That purchase order doesn't exist.");
  return po;
}

export async function approvePurchaseOrder(tenantId: string, branchId: string, actorId: string, id: string) {
  const po = await loadPo(tenantId, branchId, id);
  if (po.status !== "DRAFT") throw new HttpError(409, `PO #${po.number} is ${po.status.toLowerCase()}, not a draft.`);
  const res = await tenantDb(tenantId).purchaseOrder.updateMany({
    where: { id: po.id, status: "DRAFT" },
    data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() },
  });
  if (res.count === 0) throw new HttpError(409, `PO #${po.number} was just changed. Refresh and try again.`);
  return loadPo(tenantId, branchId, id);
}

export async function cancelPurchaseOrder(tenantId: string, branchId: string, actorId: string, id: string) {
  const po = await loadPo(tenantId, branchId, id);
  if (po.status !== "DRAFT" && po.status !== "APPROVED") {
    throw new HttpError(409, `PO #${po.number} is already ${po.status.toLowerCase()}.`);
  }
  return tenantDb(tenantId).purchaseOrder.update({
    where: { id: po.id },
    data: { status: "CANCELLED", cancelledById: actorId, cancelledAt: new Date() },
  });
}

/**
 * The goods arrived. `received` gives what came for each line; a line left out came in full.
 * Everything is written in one transaction, so a receipt is either wholly counted in or not at all.
 */
export async function receivePurchaseOrder(
  tenantId: string,
  branchId: string,
  actorId: string,
  id: string,
  received: { lineId: string; quantity: number }[] = []
) {
  const po = await loadPo(tenantId, branchId, id);
  if (po.status !== "APPROVED") {
    throw new HttpError(409, po.status === "DRAFT" ? `PO #${po.number} hasn't been approved yet.` : `PO #${po.number} is already ${po.status.toLowerCase()}.`);
  }
  const given = new Map(received.map((r) => [r.lineId, r.quantity]));
  for (const [lineId, q] of given) {
    if (!po.lines.some((l) => l.id === lineId)) throw new HttpError(400, "That line isn't on this order.");
    if (!(q >= 0)) throw new HttpError(400, "A received quantity can't be negative.");
  }
  if (po.lines.every((l) => (given.get(l.id) ?? l.quantity) === 0)) {
    throw new HttpError(400, "Nothing arrived? Cancel the order instead.");
  }

  const alerts = await runInTenantTransaction(tenantId, async (tx) => {
    const claimed = await tx.purchaseOrder.updateMany({
      where: { id: po.id, status: "APPROVED" },
      data: { status: "RECEIVED", receivedById: actorId, receivedAt: new Date() },
    });
    if (claimed.count === 0) throw new HttpError(409, `PO #${po.number} was just received on another screen.`);

    const newAlerts: NewLowStockAlert[] = [];
    for (const line of po.lines) {
      const quantity = given.get(line.id) ?? line.quantity;
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQuantity: quantity } });
      if (quantity === 0) continue;
      await tx.stockMovement.create({
        data: {
          tenantId,
          branchId,
          itemId: line.itemId,
          locationId: po.locationId,
          type: "GRN",
          quantityDelta: quantity,
          // The whole receipt's cost, as a goods-received entry typed by hand records it.
          costPaisa: Math.round(line.unitCostPaisa * quantity),
          supplierName: po.supplier.name,
          purchaseOrderId: po.id,
          actorId,
        },
      });
      const { newAlert } = await applyStockDelta(tx, tenantId, branchId, po.locationId, line.itemId, quantity);
      if (newAlert) newAlerts.push(newAlert);
    }
    return newAlerts;
  });
  await Promise.all(alerts.map((a) => notifyLowStock(tenantId, a)));
  return loadPo(tenantId, branchId, id);
}

// ---------------------------------------------------------------------------------------------
// Transfers that need approval
// ---------------------------------------------------------------------------------------------

export interface TransferInput {
  fromLocationId: string;
  toLocationId: string;
  itemId: string;
  quantity: number;
  note?: string | null;
}

/** Asked for by someone who may move stock but not approve it. Nothing moves yet. */
export async function requestTransfer(tenantId: string, actorId: string, input: TransferInput) {
  if (!(input.quantity > 0)) throw new HttpError(400, "Transfer quantity must be positive.");
  if (input.fromLocationId === input.toLocationId) throw new HttpError(400, "Source and destination must differ.");
  const db = tenantDb(tenantId);
  const [from, to, item] = await Promise.all([
    db.stockLocation.findFirst({ where: { id: input.fromLocationId } }),
    db.stockLocation.findFirst({ where: { id: input.toLocationId } }),
    db.inventoryItem.findFirst({ where: { id: input.itemId } }),
  ]);
  if (!from || !to || !item) throw new HttpError(404, "That location or item doesn't exist.");
  return db.stockTransferRequest.create({
    data: {
      tenantId,
      fromLocationId: from.id,
      toLocationId: to.id,
      itemId: item.id,
      quantity: input.quantity,
      note: input.note?.trim() || null,
      requestedById: actorId,
    },
  });
}

export async function listTransferRequests(tenantId: string) {
  const db = tenantDb(tenantId);
  const requests = await db.stockTransferRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const locIds = [...new Set(requests.flatMap((r) => [r.fromLocationId, r.toLocationId]))];
  const itemIds = [...new Set(requests.map((r) => r.itemId))];
  const userIds = [...new Set(requests.flatMap((r) => [r.requestedById, r.decidedById].filter((v): v is string => !!v)))];
  const [locs, items, users] = await Promise.all([
    locIds.length ? db.stockLocation.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true, branch: { select: { name: true } } } }) : [],
    itemIds.length ? db.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unitOfMeasure: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const loc = new Map(locs.map((l) => [l.id, `${l.branch.name} · ${l.name}`]));
  const item = new Map(items.map((i) => [i.id, i]));
  const user = new Map(users.map((u) => [u.id, u.name]));
  return requests.map((r) => ({
    id: r.id,
    status: r.status,
    from: loc.get(r.fromLocationId) ?? "?",
    to: loc.get(r.toLocationId) ?? "?",
    itemName: item.get(r.itemId)?.name ?? "?",
    unit: item.get(r.itemId)?.unitOfMeasure ?? "",
    quantity: r.quantity,
    note: r.note,
    requestedByName: user.get(r.requestedById) ?? null,
    decidedByName: r.decidedById ? (user.get(r.decidedById) ?? null) : null,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt,
  }));
}

/** Approving runs the transfer through recordTransfer — the same code as a direct transfer. */
export async function decideTransferRequest(
  tenantId: string,
  actorId: string,
  id: string,
  decision: { approve: true } | { approve: false; reason: string }
) {
  const db = tenantDb(tenantId);
  const request = await db.stockTransferRequest.findFirst({ where: { id } });
  if (!request) throw new HttpError(404, "That transfer request doesn't exist.");
  if (request.status !== "PENDING") throw new HttpError(409, `That request was already ${request.status.toLowerCase()}.`);

  if (!decision.approve) {
    const reason = decision.reason.trim();
    if (reason.length < 2) throw new HttpError(400, "Say why it's being turned down.");
    return db.stockTransferRequest.update({
      where: { id },
      data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), rejectionReason: reason },
    });
  }

  // Claim it first, so two managers approving at once can't move the stock twice.
  const claimed = await db.stockTransferRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", decidedById: actorId, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new HttpError(409, "That request was just decided on another screen.");
  try {
    const result = await recordTransfer(tenantId, actorId, {
      fromLocationId: request.fromLocationId,
      toLocationId: request.toLocationId,
      itemId: request.itemId,
      quantity: request.quantity,
    });
    return db.stockTransferRequest.update({ where: { id }, data: { transferGroupId: result.transferGroupId } });
  } catch (e) {
    // Not enough stock any more, say: put it back to pending so it can be decided again.
    await db.stockTransferRequest.update({ where: { id }, data: { status: "PENDING", decidedById: null, decidedAt: null } });
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Undoing a stock adjustment
// ---------------------------------------------------------------------------------------------

/**
 * Undoes a stock adjustment — typed 50 instead of 5 — by writing the opposite movement, never by
 * deleting the first. The ledger stays append-only; reversalOfId is unique, so an adjustment can
 * only be undone once however many times the button is pressed.
 */
export async function reverseAdjustment(tenantId: string, actorId: string, movementId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 2) throw new HttpError(400, "Say why the adjustment is being undone.");
  const db = tenantDb(tenantId);
  const original = await db.stockMovement.findFirst({ where: { id: movementId } });
  if (!original) throw new HttpError(404, "That stock movement doesn't exist.");
  if (original.type !== "ADJUSTMENT") throw new HttpError(400, "Only a stock adjustment can be undone this way.");
  if (original.reversalOfId) throw new HttpError(400, "That is itself an undo.");
  const already = await db.stockMovement.findFirst({ where: { reversalOfId: original.id } });
  if (already) throw new HttpError(409, "That adjustment has already been undone.");

  try {
    const { newAlert } = await runInTenantTransaction(tenantId, async (tx) => {
      await tx.stockMovement.create({
        data: {
          tenantId,
          branchId: original.branchId,
          itemId: original.itemId,
          locationId: original.locationId,
          type: "ADJUSTMENT",
          quantityDelta: -original.quantityDelta,
          reason: `Undo: ${why}`,
          reversalOfId: original.id,
          actorId,
        },
      });
      return applyStockDelta(tx, tenantId, original.branchId, original.locationId, original.itemId, -original.quantityDelta);
    });
    if (newAlert) await notifyLowStock(tenantId, newAlert);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "That adjustment has already been undone.");
    }
    throw e;
  }
}

/** The branch's recent stock adjustments, newest first, with whether each has been undone. */
export async function listRecentAdjustments(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  const rows = await db.stockMovement.findMany({
    where: { branchId, type: "ADJUSTMENT" },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { item: { select: { name: true, unitOfMeasure: true } }, location: { select: { name: true } } },
  });
  const undone = new Set(rows.map((r) => r.reversalOfId).filter((v): v is string => !!v));
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
  const users = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  // An undo made before the list window still counts, so check the ones not caught above directly.
  const originals = rows.filter((r) => !r.reversalOfId).map((r) => r.id);
  const reversals = originals.length
    ? await db.stockMovement.findMany({ where: { reversalOfId: { in: originals } }, select: { reversalOfId: true } })
    : [];
  for (const r of reversals) if (r.reversalOfId) undone.add(r.reversalOfId);
  return rows.map((r) => ({
    id: r.id,
    itemName: r.item.name,
    unit: r.item.unitOfMeasure,
    locationName: r.location.name,
    quantityDelta: r.quantityDelta,
    reason: r.reason,
    byName: r.actorId ? (name.get(r.actorId) ?? null) : null,
    createdAt: r.createdAt,
    isUndo: r.reversalOfId !== null,
    undone: undone.has(r.id),
  }));
}
