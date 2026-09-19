"use client";

import { newOrderId } from "@/lib/ids";
import type { CartLine, CustomerDto, OrderDto, OrderType } from "@/components/pos/types";
import {
  enqueueAction,
  listQueue,
  removeAction,
  updateAction,
  listActionsForOrder,
  type CreateOrderAction,
  type CreateOrderPayload,
  type PayOrderAction,
  type VoidOrderAction,
} from "./db";

/** True conflict signal from the server — see the HttpError(409, ..., {code:"SYNC_CONFLICT"})
 * calls in src/server/orders.ts. Anything else 4xx/5xx is a genuine business error, not a
 * sync conflict, and is surfaced differently (status "failed" rather than "conflict"). */
function isSyncConflict(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { issues?: { code?: string } }).issues?.code === "SYNC_CONFLICT";
}

/** Distinguishes "the request never reached the server" (still offline — stop replaying, retry
 * the whole batch later) from "the server responded" (with success, a conflict, or a real error —
 * keep going through the rest of the queue). fetch() only throws for the former. */
class NetworkUnreachableError extends Error {}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new NetworkUnreachableError();
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ---- Enqueuing (called by the POS UI when a request fails or the device is already offline) ----

export function buildLocalOrder(params: {
  orderId: string;
  orderNumber: number;
  type: OrderType;
  lines: CartLine[];
  totalPaisa: number;
}): OrderDto {
  return {
    id: params.orderId,
    orderNumber: params.orderNumber,
    type: params.type,
    status: "OPEN",
    totalPaisa: params.totalPaisa,
    paidPaisa: 0,
    tableId: null,
    createdAt: new Date().toISOString(),
    lines: params.lines.map((l) => ({
      id: l.key,
      nameSnapshot: l.name,
      quantity: l.quantity,
      lineTotalPaisa: l.unitPricePaisa * l.quantity,
      kitchenReady: false,
    })),
  };
}

export async function queueCreateOrder(args: {
  type: OrderType;
  tableId?: string;
  customer?: CustomerDto | null;
  lines: CartLine[];
  orderDiscount?: { type: "PERCENT" | "FIXED"; value: number };
  totalPaisa: number;
  localOrderNumber: number;
  /** Reuse the same order id / idempotencyKey an earlier online attempt for this exact submission
   * already used, rather than minting fresh ones — critical when this is a *fallback* after a
   * request that may have actually reached and been applied by the server before the response was
   * lost (a dropped connection mid-response, not "never sent"). Without this, that fallback would
   * create a second, genuinely duplicate order once the queue replays, since the server has no way
   * to recognize a different idempotencyKey as "the same order." Omit only when there was no prior
   * online attempt (the device was already offline before Send to Kitchen was even tapped). */
  orderId?: string;
  idempotencyKey?: string;
  deliveryAddress?: string;
}): Promise<OrderDto> {
  const orderId = args.orderId ?? newOrderId();
  const actionId = args.idempotencyKey ?? crypto.randomUUID();
  const payload: CreateOrderPayload = {
    id: orderId,
    type: args.type,
    tableId: args.tableId,
    customerId: args.customer?.id,
    lines: args.lines.map((l) => ({
      menuItemId: l.menuItemId,
      variantId: l.variantId,
      // Add-ons travel with the line or the sync reprices it without them. The cashier charged for
      // the extra shot from the local total, and the server would recompute a cheaper line on
      // replay — a customer undercharged, a kitchen ticket missing what they asked for, and no
      // error anywhere to say so. CreateOrderPayload has always had the field; nothing filled it.
      modifierIds: l.modifierIds,
      notes: l.notes,
      quantity: l.quantity,
      discount: l.discount,
    })),
    orderDiscount: args.orderDiscount,
    idempotencyKey: actionId,
    deliveryAddress: args.deliveryAddress,
  };
  const localOrder = buildLocalOrder({
    orderId,
    orderNumber: args.localOrderNumber,
    type: args.type,
    lines: args.lines,
    totalPaisa: args.totalPaisa,
  });

  const action: CreateOrderAction = {
    actionId,
    orderId,
    type: "createOrder",
    payload,
    sendToKitchen: true,
    localOrder,
    createdAt: Date.now(),
    status: "pending",
  };
  await enqueueAction(action);
  return localOrder;
}

export async function queuePayOrder(orderId: string, tenders: { method: string; amountPaisa: number }[], expectedVersion?: number) {
  const action: PayOrderAction = {
    actionId: crypto.randomUUID(),
    orderId,
    type: "pay",
    payload: { tenders },
    expectedVersion,
    createdAt: Date.now(),
    status: "pending",
  };
  await enqueueAction(action);
}

export async function queueVoidOrder(orderId: string, reason: string | undefined, expectedVersion?: number) {
  const action: VoidOrderAction = {
    actionId: crypto.randomUUID(),
    orderId,
    type: "void",
    payload: { reason },
    expectedVersion,
    createdAt: Date.now(),
    status: "pending",
  };
  await enqueueAction(action);
}

// ---- Replay ----

/** Marks every not-yet-processed queued action for the same order as blocked by this one — a
 * queued pay/void can't apply if the create (or an earlier action) it depends on didn't. */
async function cascadeBlock(orderId: string, reason: string, status: "conflict" | "failed") {
  const related = await listActionsForOrder(orderId);
  for (const a of related) {
    if (a.status === "pending") {
      await updateAction(a.actionId, { status, error: reason });
    }
  }
}

interface ReplayResult {
  synced: number;
  conflicts: number;
  failed: number;
  stoppedOffline: boolean;
}

/** Processes the queue strictly in creation order, one action at a time — a pay/void queued after
 * an offline create for the same order depends on that create having synced first, and sequential
 * FIFO replay is what guarantees that without a separate dependency graph. Stops the moment a
 * request can't reach the server at all (still offline); a conflict or business-error response
 * from a reachable server just marks that action (and anything queued after it for the same
 * order) and moves on to unrelated queue items. */
export async function replayQueue(): Promise<ReplayResult> {
  const result: ReplayResult = { synced: 0, conflicts: 0, failed: 0, stoppedOffline: false };
  const queue = await listQueue();

  for (const action of queue) {
    const current = (await listQueue()).find((a) => a.actionId === action.actionId);
    if (!current || current.status === "conflict" || current.status === "failed") continue;

    await updateAction(action.actionId, { status: "syncing" });
    try {
      if (action.type === "createOrder") {
        await replayCreateOrder(action);
      } else if (action.type === "pay") {
        await replayPay(action);
      } else {
        await replayVoid(action);
      }
      await removeAction(action.actionId);
      result.synced += 1;
    } catch (err) {
      if (err instanceof NetworkUnreachableError) {
        await updateAction(action.actionId, { status: "pending" });
        result.stoppedOffline = true;
        break;
      }
      if (err instanceof ConflictError) {
        await updateAction(action.actionId, { status: "conflict", error: err.message });
        await cascadeBlock(action.orderId, "Blocked: an earlier action on this order hit a sync conflict.", "conflict");
        result.conflicts += 1;
        continue;
      }
      const message = err instanceof Error ? err.message : "Sync failed";
      await updateAction(action.actionId, { status: "failed", error: message });
      await cascadeBlock(action.orderId, "Blocked: an earlier action on this order failed to sync.", "failed");
      result.failed += 1;
    }
  }

  return result;
}

class ConflictError extends Error {}

async function replayCreateOrder(action: CreateOrderAction) {
  const created = await postJson("/api/orders", action.payload);
  if (!created.ok) {
    if (isSyncConflict(created.data)) throw new ConflictError((created.data as { error: string }).error);
    throw new Error((created.data as { error?: string }).error ?? "Could not create order");
  }
  if (action.sendToKitchen) {
    const sent = await postJson(`/api/orders/${action.payload.id}/send-to-kitchen`, { actionId: `${action.actionId}:stk` });
    if (!sent.ok) {
      throw new Error((sent.data as { error?: string }).error ?? "Could not send order to kitchen");
    }
  }
}

async function replayPay(action: PayOrderAction) {
  const res = await postJson(`/api/orders/${action.orderId}/pay`, {
    tenders: action.payload.tenders,
    actionId: action.actionId,
    expectedVersion: action.expectedVersion,
  });
  if (!res.ok) {
    if (isSyncConflict(res.data)) throw new ConflictError((res.data as { error: string }).error);
    throw new Error((res.data as { error?: string }).error ?? "Could not take payment");
  }
}

async function replayVoid(action: VoidOrderAction) {
  const res = await postJson(`/api/orders/${action.orderId}/void`, {
    reason: action.payload.reason,
    actionId: action.actionId,
    expectedVersion: action.expectedVersion,
  });
  if (!res.ok) {
    if (isSyncConflict(res.data)) throw new ConflictError((res.data as { error: string }).error);
    throw new Error((res.data as { error?: string }).error ?? "Could not void order");
  }
}

export type { QueuedAction } from "./db";
