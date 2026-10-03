import "server-only";
import { tenantDb } from "@/server/db";
import { publish } from "@/server/realtime";
import { HttpError } from "@/server/handler";

export async function createFloor(tenantId: string, branchId: string, name: string) {
  const db = tenantDb(tenantId);
  const last = await db.floor.aggregate({ where: { branchId }, _max: { sortOrder: true } });
  return db.floor.create({ data: { tenantId, branchId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
}

export async function renameFloor(tenantId: string, floorId: string, name: string) {
  const db = tenantDb(tenantId);
  return db.floor.update({ where: { id: floorId }, data: { name } });
}

export async function deleteFloor(tenantId: string, floorId: string) {
  const db = tenantDb(tenantId);
  const tableCount = await db.restaurantTable.count({ where: { floorId } });
  if (tableCount > 0) throw new HttpError(400, "Remove or move this floor's tables before deleting it.");
  return db.floor.delete({ where: { id: floorId } });
}

export interface CreateTableInput {
  floorId: string;
  label: string;
  seats: number;
}

/**
 * The floor has to belong to the branch the caller is actually working in. `floorId` arrives from
 * the client while `branchId` comes from the session, and nothing previously checked that the two
 * agreed — RLS stops another tenant's floor, but not another branch of the same restaurant, which
 * would file the table under a floor plan nobody working that branch can see.
 */
async function assertFloorInBranch(tenantId: string, branchId: string, floorId: string) {
  const floor = await tenantDb(tenantId).floor.findUnique({ where: { id: floorId }, select: { branchId: true } });
  if (!floor) throw new HttpError(404, "That floor doesn't exist.");
  if (floor.branchId !== branchId) throw new HttpError(403, "That floor belongs to a different branch.");
}

/** A duplicate label is the one failure a manager can actually fix, so it says which name clashed
 * instead of falling through to defineHandler's generic 500. Checked up front rather than only
 * caught from the unique index, so the message can name the table by its label. */
async function assertLabelFree(tenantId: string, floorId: string, label: string, exceptTableId?: string) {
  const clash = await tenantDb(tenantId).restaurantTable.findFirst({
    where: { floorId, label, ...(exceptTableId ? { NOT: { id: exceptTableId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new HttpError(409, `This floor already has a table called "${label}".`);
}

export async function createTable(tenantId: string, branchId: string, input: CreateTableInput) {
  const db = tenantDb(tenantId);
  const label = input.label.trim();
  await assertFloorInBranch(tenantId, branchId, input.floorId);
  await assertLabelFree(tenantId, input.floorId, label);
  return db.restaurantTable.create({
    data: { tenantId, branchId, floorId: input.floorId, label, seats: input.seats },
  });
}

export interface UpdateTableInput {
  label?: string;
  seats?: number;
  floorId?: string;
}

export async function updateTable(tenantId: string, tableId: string, input: UpdateTableInput) {
  const db = tenantDb(tenantId);
  const existing = await db.restaurantTable.findUnique({
    where: { id: tableId },
    select: { branchId: true, floorId: true, label: true },
  });
  if (!existing) throw new HttpError(404, "That table doesn't exist.");

  // Moving a table and renaming it can happen in the same request, so both the destination floor
  // and the name are resolved before either is checked.
  const floorId = input.floorId ?? existing.floorId;
  const label = input.label?.trim() ?? existing.label;
  if (input.floorId && input.floorId !== existing.floorId) {
    await assertFloorInBranch(tenantId, existing.branchId, input.floorId);
  }
  if (floorId !== existing.floorId || label !== existing.label) {
    await assertLabelFree(tenantId, floorId, label, tableId);
  }

  return db.restaurantTable.update({ where: { id: tableId }, data: { ...input, label } });
}

export async function deleteTable(tenantId: string, tableId: string) {
  const db = tenantDb(tenantId);
  const openOrder = await db.order.findFirst({
    where: { tableId, status: { notIn: ["PAID", "VOIDED", "CANCELLED", "DELETED", "DELIVERED"] } },
  });
  if (openOrder) throw new HttpError(400, "This table has an open order — close it before deleting the table.");
  return db.restaurantTable.delete({ where: { id: tableId } });
}

/** Table status changes broadcast on the "tables" realtime channel (same topic/publish pattern as
 * KDS) so a table occupied on one device shows occupied everywhere within a second or two. */
export async function setTableStatus(
  tenantId: string,
  branchId: string,
  tableId: string,
  status: "AVAILABLE" | "RESERVED" | "BOOKED" | "OCCUPIED"
) {
  const db = tenantDb(tenantId);
  const table = await db.restaurantTable.update({ where: { id: tableId }, data: { status } });
  await publish(tenantId, branchId, "tables", "table_status_changed", { tableId, status });
  return table;
}

/** The order a tap on an occupied table should resume — the most recent still-open order at that
 * table, if any. */
export async function findActiveOrderForTable(tenantId: string, tableId: string) {
  const db = tenantDb(tenantId);
  return db.order.findFirst({
    where: { tableId, status: { notIn: ["PAID", "VOIDED", "CANCELLED", "DELETED", "DELIVERED"] } },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
}
