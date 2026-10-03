import "server-only";
import { tenantDb } from "@/server/db";
import { branchTodayStart } from "@/server/branch-settings";

/**
 * What has happened to this branch's orders since a moment — for the till's alerts.
 *
 * A waiter punching an order on their own phone used to reach the kitchen and nobody at the counter:
 * no pop-up, no sound, nothing until the cashier happened to open the Order Queue. Online and QR
 * orders arrived just as silently. The till now asks this "what's new since I last looked?" whenever
 * the live channel says something changed, and on a short timer in case the channel is down, and
 * shows each new order, each round added to a table, and each order that is ready.
 *
 * Deliberately small: a few fields per order, and only what changed since the caller's last look,
 * so every till in the branch can ask often without dragging the full order list each time.
 *
 * In a branch that holds waiter orders for the counter (src/server/order-approvals.ts) it also
 * carries each new request, for the counter, and each decision, for the waiter who asked.
 *
 * Times come from the server — `now` is returned for the caller to send back as `since` — so a till
 * whose clock is wrong still misses nothing and sees nothing twice. An order landing exactly on the
 * boundary can come back in two consecutive answers; the till drops ones it has already shown.
 */

export interface OrderActivity {
  /** Send this back as `since` next time. */
  now: string;
  newOrders: {
    id: string;
    orderNumber: number;
    type: string;
    source: string;
    tableLabel: string | null;
    totalPaisa: number;
    itemCount: number;
    /** OPEN is not in the kitchen yet — in a branch that approves waiter orders, waiting to be. */
    status: string;
    /** Null for an online or QR order — a customer placed it. */
    createdById: string | null;
    createdByName: string | null;
  }[];
  itemsAdded: {
    eventId: string;
    orderId: string;
    orderNumber: number;
    tableLabel: string | null;
    itemCount: number;
    addedById: string | null;
    addedByName: string | null;
  }[];
  readyOrders: {
    id: string;
    orderNumber: number;
    type: string;
    source: string;
    tableLabel: string | null;
    readyAt: string;
    createdById: string | null;
  }[];
  /** Today's orders still to be paid — the number on the till's Order Queue button. */
  awaitingPayment: number;
  /** Waiter orders and rounds asked for since `since` — for the counter. */
  approvalRequests: {
    id: string;
    kind: "NEW_ORDER" | "MORE_ITEMS";
    orderId: string;
    orderNumber: number;
    tableLabel: string | null;
    itemCount: number;
    requestedById: string | null;
    requestedByName: string | null;
  }[];
  /** Requests decided since `since` — for the waiter who asked. */
  approvalDecisions: {
    id: string;
    kind: "NEW_ORDER" | "MORE_ITEMS";
    orderNumber: number;
    tableLabel: string | null;
    status: "APPROVED" | "REJECTED";
    requestedById: string | null;
    rejectReason: string | null;
  }[];
  /** Requests still waiting for the counter — the number beside the Order Queue button. */
  pendingApprovals: number;
}

/** How far back a first look reaches: nothing, so opening the till doesn't replay the morning. */
export async function orderActivity(tenantId: string, branchId: string, since: Date | null): Promise<OrderActivity> {
  const now = new Date();
  const db = tenantDb(tenantId);
  const from = since ?? now;
  const dayStart = await branchTodayStart(tenantId, branchId, now);

  const [created, appended, ready, awaitingPayment, requested, decided, pendingApprovals] = await Promise.all([
    db.order.findMany({
      where: { branchId, createdAt: { gte: from }, status: { notIn: ["VOIDED", "CANCELLED", "DELETED"] } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        type: true,
        source: true,
        status: true,
        totalPaisa: true,
        createdById: true,
        createdBy: { select: { name: true } },
        table: { select: { label: true } },
        lines: { where: { isVoided: false }, select: { quantity: true } },
      },
    }),
    db.orderEvent.findMany({
      where: { type: "PUNCHED", createdAt: { gte: from }, order: { branchId } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        orderId: true,
        actorId: true,
        payload: true,
        order: { select: { orderNumber: true, table: { select: { label: true } } } },
      },
    }),
    db.order.findMany({
      where: { branchId, readyAt: { gte: from }, status: { notIn: ["VOIDED", "CANCELLED", "DELETED"] } },
      orderBy: { readyAt: "asc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        type: true,
        source: true,
        readyAt: true,
        createdById: true,
        table: { select: { label: true } },
      },
    }),
    // Today's, like the Order Queue itself: an earlier day's unpaid order is listed there apart.
    db.order.count({
      where: {
        branchId,
        createdAt: { gte: dayStart },
        OR: [
          { status: { in: ["OPEN", "SENT_TO_KITCHEN", "READY", "SERVED"] } },
          // Cash on delivery, delivered, the rider's cash not yet handed in.
          { status: "DELIVERED", paidAt: null },
        ],
      },
    }),
    db.orderApproval.findMany({
      where: { branchId, requestedAt: { gte: from } },
      orderBy: { requestedAt: "asc" },
      take: 50,
      select: { id: true, kind: true, orderId: true, lines: true, requestedById: true },
    }),
    db.orderApproval.findMany({
      where: { branchId, decidedAt: { gte: from } },
      orderBy: { decidedAt: "asc" },
      take: 50,
      select: { id: true, kind: true, orderId: true, status: true, requestedById: true, rejectReason: true },
    }),
    db.orderApproval.count({ where: { branchId, status: "PENDING" } }),
  ]);

  // Only the "more items for a table already eating" events: a PUNCHED event is also written when an
  // order is first created, and that one is already a new order above.
  const rounds = appended.filter((e) => (e.payload as { appended?: boolean } | null)?.appended === true);
  const actorIds = [
    ...new Set([...rounds.map((e) => e.actorId), ...requested.map((a) => a.requestedById)].filter((v): v is string => !!v)),
  ];
  const approvalOrderIds = [...new Set([...requested, ...decided].map((a) => a.orderId))];
  const [actors, approvalOrders] = await Promise.all([
    actorIds.length ? db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [],
    approvalOrderIds.length
      ? db.order.findMany({
          where: { id: { in: approvalOrderIds } },
          select: { id: true, orderNumber: true, table: { select: { label: true } }, lines: { where: { isVoided: false }, select: { quantity: true } } },
        })
      : [],
  ]);
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const approvalOrder = new Map(approvalOrders.map((o) => [o.id, o]));
  const roundItemCount = (lines: unknown) =>
    ((lines as { display?: { quantity: number }[] } | null)?.display ?? []).reduce((s, l) => s + l.quantity, 0);

  return {
    now: now.toISOString(),
    newOrders: created.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      type: o.type,
      source: o.source,
      tableLabel: o.table?.label ?? null,
      totalPaisa: o.totalPaisa,
      itemCount: o.lines.reduce((s, l) => s + l.quantity, 0),
      status: o.status,
      createdById: o.createdById,
      createdByName: o.createdBy?.name ?? null,
    })),
    itemsAdded: rounds.map((e) => ({
      eventId: e.id,
      orderId: e.orderId,
      orderNumber: e.order.orderNumber,
      tableLabel: e.order.table?.label ?? null,
      itemCount: (e.payload as { lineCount?: number } | null)?.lineCount ?? 0,
      addedById: e.actorId,
      addedByName: e.actorId ? (actorName.get(e.actorId) ?? null) : null,
    })),
    readyOrders: ready.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      type: o.type,
      source: o.source,
      tableLabel: o.table?.label ?? null,
      readyAt: o.readyAt!.toISOString(),
      createdById: o.createdById,
    })),
    awaitingPayment,
    approvalRequests: requested.flatMap((a) => {
      const order = approvalOrder.get(a.orderId);
      if (!order) return [];
      return [
        {
          id: a.id,
          kind: a.kind,
          orderId: a.orderId,
          orderNumber: order.orderNumber,
          tableLabel: order.table?.label ?? null,
          itemCount: a.kind === "MORE_ITEMS" ? roundItemCount(a.lines) : order.lines.reduce((s, l) => s + l.quantity, 0),
          requestedById: a.requestedById,
          requestedByName: a.requestedById ? (actorName.get(a.requestedById) ?? null) : null,
        },
      ];
    }),
    approvalDecisions: decided.flatMap((a) => {
      const order = approvalOrder.get(a.orderId);
      if (!order || a.status === "PENDING") return [];
      return [
        {
          id: a.id,
          kind: a.kind,
          orderNumber: order.orderNumber,
          tableLabel: order.table?.label ?? null,
          status: a.status,
          requestedById: a.requestedById,
          rejectReason: a.rejectReason,
        },
      ];
    }),
    pendingApprovals,
  };
}
