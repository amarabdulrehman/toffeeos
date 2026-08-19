import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import type { TenantTransactionClient } from "@/server/db";

export type SyncConflictKind = "TABLE_DOUBLE_ORDER" | "STALE_ORDER_ACTION";

interface RecordConflictInput {
  tenantId: string;
  branchId: string;
  kind: SyncConflictKind;
  tableId?: string;
  orderId?: string;
  conflictingOrderId?: string;
  actionType?: string;
  devicePayload?: unknown;
  serverSnapshot?: unknown;
}

/** Writes the conflict record a manager will later see and resolve. Called from inside the same
 * transaction as the action that detected the conflict, so the conflict record and the (refused)
 * mutation are consistent with each other. */
export async function recordConflict(tx: TenantTransactionClient, input: RecordConflictInput) {
  await tx.syncConflict.create({
    data: {
      tenantId: input.tenantId,
      branchId: input.branchId,
      kind: input.kind,
      tableId: input.tableId,
      orderId: input.orderId,
      conflictingOrderId: input.conflictingOrderId,
      actionType: input.actionType,
      devicePayload: input.devicePayload as never,
      serverSnapshot: input.serverSnapshot as never,
    },
  });
}

export async function listConflicts(tenantId: string, branchIds: string[]) {
  const db = tenantDb(tenantId);
  return db.syncConflict.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function resolveConflict(tenantId: string, conflictId: string, actorId: string, note: string) {
  const db = tenantDb(tenantId);
  const conflict = await db.syncConflict.findUnique({ where: { id: conflictId } });
  if (!conflict) throw new HttpError(404, "Conflict not found.");
  if (conflict.status === "RESOLVED") throw new HttpError(409, "This conflict was already resolved.");

  return db.syncConflict.update({
    where: { id: conflictId },
    data: { status: "RESOLVED", resolutionNote: note, resolvedById: actorId, resolvedAt: new Date() },
  });
}
