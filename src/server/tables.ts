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

export async function createTable(tenantId: string, branchId: string, input: CreateTableInput) {
  const db = tenantDb(tenantId);
  return db.restaurantTable.create({
    data: { tenantId, branchId, floorId: input.floorId, label: input.label, seats: input.seats },
  });
}

export interface UpdateTableInput {
  label?: string;
  seats?: number;
  floorId?: string;
}

export async function updateTable(tenantId: string, tableId: string, input: UpdateTableInput) {
  const db = tenantDb(tenantId);
  return db.restaurantTable.update({ where: { id: tableId }, data: input });
}

export async function deleteTable(tenantId: string, tableId: string) {
  const db = tenantDb(tenantId);
  const openOrder = await db.order.findFirst({
    where: { tableId, status: { notIn: ["PAID", "VOIDED", "CANCELLED", "DELIVERED"] } },
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
    where: { tableId, status: { notIn: ["PAID", "VOIDED", "CANCELLED", "DELIVERED"] } },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
}
