import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { publish } from "@/server/realtime";
import {
  addLinesToOrder,
  resolveLines,
  sendToKitchen,
  voidOrder,
  TERMINAL_ORDER_STATUSES,
  type CreateOrderLineInput,
} from "@/server/orders";

/**
 * Waiter orders that wait for the counter (BranchSettings.waiterOrdersNeedApproval).
 *
 * Some restaurants want a waiter's order checked at the counter before the kitchen starts on it;
 * most want it in the kitchen at once, so it is a switch per branch, off by default. When it is on,
 * anyone who can't take payment — a waiter — sends to the counter instead of the kitchen:
 *
 * - A new order is created as usual but stays OPEN, out of the kitchen, with a NEW_ORDER request.
 *   Approved, it is sent to the kitchen; rejected, it is voided (never a sale) and its table freed.
 * - Another round for a table already eating is not added to the order at all while it waits: the
 *   request carries the lines, and only an approval adds them — to the bill and the kitchen at once.
 *   A rejected round never touched either.
 *
 * "The counter" is whoever can take payment (pos.payment.take): the cashier the owner means, and
 * managers and owners with them. Their own orders never wait. Payment waits for any pending
 * request on the order (see takePayment), and voiding or cancelling an order closes its requests.
 */

export const APPROVER_PERMISSION = "pos.payment.take";

type ApprovalLines = {
  input: CreateOrderLineInput[];
  display: { name: string; quantity: number; notes: string | null; modifiers: string[] }[];
};

export interface PendingApprovalDto {
  id: string;
  kind: "NEW_ORDER" | "MORE_ITEMS";
  orderId: string;
  orderNumber: number;
  orderType: string;
  tableLabel: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  items: { name: string; quantity: number; notes: string | null; modifiers: string[] }[];
}

/** Whether this branch holds waiter orders for the counter. */
export async function getBranchOrdersNeedApproval(tenantId: string, branchId: string): Promise<boolean> {
  const settings = await tenantDb(tenantId).branchSettings.findUnique({
    where: { branchId },
    select: { waiterOrdersNeedApproval: true },
  });
  return settings?.waiterOrdersNeedApproval ?? false;
}

/** Whether this person's orders wait at the counter: the branch asks for it, and they can't take payment. */
export async function ordersNeedApproval(
  tenantId: string,
  branchId: string,
  permissions: readonly string[],
): Promise<boolean> {
  if (permissions.includes(APPROVER_PERMISSION)) return false;
  return getBranchOrdersNeedApproval(tenantId, branchId);
}

function isTerminal(status: string): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

async function loadOrder(tenantId: string, branchId: string, orderId: string) {
  const order = await tenantDb(tenantId).order.findFirst({ where: { id: orderId, branchId } });
  if (!order) throw new HttpError(404, "Order not found.");
  return order;
}

/**
 * A waiter's new order, held at the counter instead of going to the kitchen. Safe to call twice —
 * a retried send, or one replayed from the offline queue, finds the request already there.
 */
export async function requestNewOrderApproval(tenantId: string, branchId: string, orderId: string, actorId: string) {
  const db = tenantDb(tenantId);
  const order = await loadOrder(tenantId, branchId, orderId);
  // Already in the kitchen (approved, and this is a retry) or closed: nothing to ask.
  if (order.status !== "OPEN") return { order, awaitingApproval: false };

  const existing = await db.orderApproval.findFirst({ where: { orderId, kind: "NEW_ORDER", status: "PENDING" } });
  if (existing) return { order, awaitingApproval: true };
  try {
    await db.orderApproval.create({ data: { tenantId, branchId, orderId, kind: "NEW_ORDER", requestedById: actorId } });
  } catch (err) {
    // Two sends racing: the partial unique index lets one request through, and the other is the same.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      return { order, awaitingApproval: true };
    throw err;
  }
  await db.orderEvent.create({
    data: { tenantId, orderId, type: "APPROVAL_REQUESTED", actorId, payload: { kind: "NEW_ORDER" } },
  });
  await publish(tenantId, branchId, "orders", "approval_requested", { orderId });
  return { order, awaitingApproval: true };
}

/** Another round, held at the counter. Checked now (the dishes exist and are on sale), added only if approved. */
export async function requestMoreItemsApproval(
  tenantId: string,
  branchId: string,
  orderId: string,
  lines: CreateOrderLineInput[],
  actorId: string,
) {
  const db = tenantDb(tenantId);
  const order = await loadOrder(tenantId, branchId, orderId);
  if (isTerminal(order.status)) {
    throw new HttpError(409, `This order is already ${order.status.toLowerCase()} and can't take more items.`);
  }
  const resolved = await resolveLines(tenantId, branchId, lines);
  const payload: ApprovalLines = {
    input: lines,
    display: resolved.map((l) => ({
      name: l.nameSnapshot,
      quantity: l.quantity,
      notes: l.notes ?? null,
      modifiers: l.modifiers.map((m) => m.nameSnapshot),
    })),
  };
  await db.orderApproval.create({
    data: {
      tenantId,
      branchId,
      orderId,
      kind: "MORE_ITEMS",
      lines: payload as unknown as Prisma.InputJsonValue,
      requestedById: actorId,
    },
  });
  await db.orderEvent.create({
    data: {
      tenantId,
      orderId,
      type: "APPROVAL_REQUESTED",
      actorId,
      payload: { kind: "MORE_ITEMS", lineCount: lines.length },
    },
  });
  await publish(tenantId, branchId, "orders", "approval_requested", { orderId });
  return { order, awaitingApproval: true };
}

/** Everything waiting for the counter in this branch, oldest first, with what is being asked for. */
export async function listPendingApprovals(tenantId: string, branchId: string): Promise<PendingApprovalDto[]> {
  const db = tenantDb(tenantId);
  const pending = await db.orderApproval.findMany({
    where: { branchId, status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    take: 100,
  });
  if (pending.length === 0) return [];

  const orderIds = [...new Set(pending.map((a) => a.orderId))];
  const userIds = [...new Set(pending.map((a) => a.requestedById).filter((v): v is string => !!v))];
  const [orders, users] = await Promise.all([
    db.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderNumber: true,
        type: true,
        status: true,
        table: { select: { label: true } },
        lines: {
          where: { isVoided: false },
          select: { nameSnapshot: true, quantity: true, notes: true, modifiers: { select: { nameSnapshot: true } } },
        },
      },
    }),
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return pending.flatMap((a) => {
    const order = orderById.get(a.orderId);
    // An order closed some other way (merged into another bill, say) has nothing left to decide.
    if (!order || isTerminal(order.status)) return [];
    const items =
      a.kind === "MORE_ITEMS"
        ? ((a.lines as unknown as ApprovalLines | null)?.display ?? [])
        : order.lines.map((l) => ({
            name: l.nameSnapshot,
            quantity: l.quantity,
            notes: l.notes,
            modifiers: l.modifiers.map((m) => m.nameSnapshot),
          }));
    return [
      {
        id: a.id,
        kind: a.kind,
        orderId: a.orderId,
        orderNumber: order.orderNumber,
        orderType: order.type,
        tableLabel: order.table?.label ?? null,
        requestedById: a.requestedById,
        requestedByName: a.requestedById ? (nameById.get(a.requestedById) ?? null) : null,
        requestedAt: a.requestedAt.toISOString(),
        items,
      },
    ];
  });
}

/** The request to decide on — still waiting, in this branch, on an order that is still open. */
async function claimable(tenantId: string, branchId: string, approvalId: string, deciderId: string) {
  const db = tenantDb(tenantId);
  const approval = await db.orderApproval.findFirst({ where: { id: approvalId, branchId } });
  if (!approval) throw new HttpError(404, "That request is no longer waiting.");
  if (approval.status !== "PENDING") {
    throw new HttpError(
      409,
      approval.status === "APPROVED" ? "This was already sent to the kitchen." : "This was already rejected.",
    );
  }
  const order = await loadOrder(tenantId, branchId, approval.orderId);
  if (isTerminal(order.status)) {
    // Closed some other way: close the request too, so it stops counting as waiting.
    await db.orderApproval.updateMany({
      where: { id: approvalId, status: "PENDING" },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        decidedById: deciderId,
        rejectReason: `The order was already ${order.status.toLowerCase()}.`,
      },
    });
    throw new HttpError(409, `This order is already ${order.status.toLowerCase()}.`);
  }
  return { approval, order };
}

/** Marks the request decided — only if it is still waiting, so two cashiers tapping at once can't both win. */
async function claim(
  tenantId: string,
  approvalId: string,
  data: { status: "APPROVED" } | { status: "REJECTED"; rejectReason: string },
  deciderId: string,
) {
  const claimed = await tenantDb(tenantId).orderApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: { ...data, decidedById: deciderId, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new HttpError(409, "Someone else has just decided on this.");
}

/** Sends a held order to the kitchen, or adds a held round to its order. */
export async function approveOrderRequest(tenantId: string, branchId: string, approvalId: string, deciderId: string) {
  const db = tenantDb(tenantId);
  const { approval, order } = await claimable(tenantId, branchId, approvalId, deciderId);
  await claim(tenantId, approvalId, { status: "APPROVED" }, deciderId);
  try {
    if (approval.kind === "NEW_ORDER") {
      if (order.status === "OPEN") await sendToKitchen(tenantId, branchId, order.id, deciderId);
    } else {
      const lines = (approval.lines as unknown as ApprovalLines).input;
      // Added as the approver, so the cashier who just approved it isn't told about it a second time
      // as "more items for Table 3"; who asked for them stays on the request.
      await addLinesToOrder(tenantId, branchId, order.id, lines, deciderId, false);
    }
  } catch (err) {
    // Put it back, so it can be tried again or rejected — never left "approved" with nothing done.
    await db.orderApproval.update({
      where: { id: approvalId },
      data: { status: "PENDING", decidedById: null, decidedAt: null },
    });
    throw err;
  }
  await db.orderEvent.create({
    data: {
      tenantId,
      orderId: order.id,
      type: "APPROVED",
      actorId: deciderId,
      payload: { kind: approval.kind, approvalId },
    },
  });
  await publish(tenantId, branchId, "orders", "approval_decided", { orderId: order.id });
  return { orderId: order.id, orderNumber: order.orderNumber, kind: approval.kind };
}

/** Turns a held order or round away: the order is voided (never a sale); a round is simply never added. */
export async function rejectOrderRequest(
  tenantId: string,
  branchId: string,
  approvalId: string,
  deciderId: string,
  reason: string,
) {
  const db = tenantDb(tenantId);
  const { approval, order } = await claimable(tenantId, branchId, approvalId, deciderId);
  await claim(tenantId, approvalId, { status: "REJECTED", rejectReason: reason }, deciderId);
  if (approval.kind === "NEW_ORDER") {
    try {
      await voidOrder(tenantId, branchId, order.id, deciderId, `Not approved: ${reason}`);
    } catch (err) {
      await db.orderApproval.update({
        where: { id: approvalId },
        data: { status: "PENDING", decidedById: null, decidedAt: null, rejectReason: null },
      });
      throw err;
    }
  }
  await db.orderEvent.create({
    data: {
      tenantId,
      orderId: order.id,
      type: "REJECTED",
      actorId: deciderId,
      payload: { kind: approval.kind, approvalId, reason },
    },
  });
  await publish(tenantId, branchId, "orders", "approval_decided", { orderId: order.id });
  return { orderId: order.id, orderNumber: order.orderNumber, kind: approval.kind };
}
