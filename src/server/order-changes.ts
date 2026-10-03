import "server-only";
import { runInTenantTransaction, tenantDb, type TenantTransactionClient } from "@/server/db";
import { newId, newOrderLineId } from "@/lib/ids";
import { publish } from "@/server/realtime";
import { HttpError } from "@/server/handler";
import { TERMINAL_ORDER_STATUSES, findOpenOrderForTable, getBranchPricingContext, pricingLinesFromStored } from "@/server/orders";
import { computeProvisionalTotal, type DiscountInput } from "@/lib/pricing";

/**
 * Changing an order after it was punched: voiding one item, switching dine-in and takeaway, merging
 * two tables, exempting it from tax, and — for the kitchen — bringing back an order bumped by
 * mistake.
 *
 * Every change that touches what the order contains ends the same way: the order is priced again
 * from its stored lines through the same engine that priced it the first time, inside the same
 * transaction as the change. An order whose lines and totals disagree, even briefly, is how a till
 * charges for an item that was taken off the bill.
 *
 * Each writes an OrderEvent saying who did what and why, which is what the voids report and an
 * owner's "who took that off?" read from.
 */

type StoredOrder = Awaited<ReturnType<typeof loadOrder>>;

async function loadOrder(tenantId: string, branchId: string, orderId: string) {
  const order = await tenantDb(tenantId).order.findFirst({
    where: { id: orderId, branchId },
    include: { lines: { include: { modifiers: true } }, discounts: true, table: true },
  });
  if (!order) throw new HttpError(404, "That order doesn't exist.");
  return order;
}

function assertChangeable(order: StoredOrder, action: string) {
  if (order.status === "PAID") {
    throw new HttpError(409, `Order #${order.orderNumber} is already paid, so it can't be ${action}. Refund it instead.`);
  }
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new HttpError(409, `Order #${order.orderNumber} is already ${order.status.toLowerCase()}.`);
  }
}

/**
 * Provisional totals for an order as its lines now stand — the figures createOrder would store.
 * Exported for loyalty redemption, which prices an order with the discount it is about to add.
 */
export async function provisionalTotals(
  tenantId: string,
  branchId: string,
  order: { type: StoredOrder["type"]; taxExemptReason: string | null; discounts: { type: "PERCENT" | "FIXED"; value: number }[] },
  lines: Parameters<typeof pricingLinesFromStored>[0]
) {
  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, order.type, order.taxExemptReason !== null);
  const discount: DiscountInput | undefined = order.discounts[0]
    ? { type: order.discounts[0].type, value: order.discounts[0].value }
    : undefined;
  const t = computeProvisionalTotal(pricingLinesFromStored(lines), discount, taxRules, settings);
  return {
    subtotalPaisa: t.subtotalPaisa,
    discountedSubtotalPaisa: t.discountedSubtotalPaisa,
    serviceChargePaisa: t.serviceChargePaisa,
    taxPaisa: t.taxPaisa,
    roundingAdjustmentPaisa: t.roundingAdjustmentPaisa,
    totalPaisa: t.totalPaisa,
  };
}

// ---------------------------------------------------------------------------------------------
// Void one item
// ---------------------------------------------------------------------------------------------

/**
 * Takes one item — or some of a quantity — off an order that hasn't been paid.
 *
 * Voiding part of a line splits it: the line keeps what is still wanted and a second, voided line
 * records what was taken off, with its add-ons. Nothing is deleted, so the kitchen screen can show
 * the struck-through item and the voids report can say exactly what went.
 *
 * The last item can't be voided this way: an order with nothing on it is a void of the whole order,
 * which has its own button, its own permission and its own line in the reports.
 */
export async function voidOrderLine(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { orderId: string; lineId: string; quantity?: number; reason: string }
) {
  const order = await loadOrder(tenantId, branchId, input.orderId);
  assertChangeable(order, "changed");

  const line = order.lines.find((l) => l.id === input.lineId);
  if (!line || line.isVoided) throw new HttpError(404, "That item isn't on this order, or has already been voided.");

  const quantity = input.quantity ?? line.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity) {
    throw new HttpError(400, `Void between 1 and ${line.quantity} of ${line.nameSnapshot}.`);
  }
  const partial = quantity < line.quantity;
  const othersLeft = order.lines.some((l) => !l.isVoided && l.id !== line.id);
  if (!partial && !othersLeft) {
    throw new HttpError(400, "That is the last item on the order. Void the whole order instead.");
  }

  const voidedLineId = partial ? newOrderLineId() : line.id;
  const afterLines = order.lines.flatMap((l) => {
    if (l.id !== line.id) return [l];
    if (!partial) return [{ ...l, isVoided: true }];
    return [
      { ...l, quantity: l.quantity - quantity },
      { ...l, id: voidedLineId, quantity, isVoided: true },
    ];
  });
  const totals = await provisionalTotals(tenantId, branchId, order, afterLines);
  const valuePaisa = line.unitPricePaisa * quantity;

  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    await guardVersion(tx, order);
    if (partial) {
      const remaining = line.quantity - quantity;
      await tx.orderLine.update({
        where: { id: line.id },
        data: { quantity: remaining, lineTotalPaisa: line.unitPricePaisa * remaining },
      });
      await tx.orderLine.create({
        data: {
          id: voidedLineId,
          tenantId,
          orderId: order.id,
          menuItemId: line.menuItemId,
          variantId: line.variantId,
          nameSnapshot: line.nameSnapshot,
          unitPricePaisa: line.unitPricePaisa,
          quantity,
          discountType: line.discountType,
          discountValue: line.discountValue,
          lineTotalPaisa: valuePaisa,
          isVoided: true,
          kitchenReady: line.kitchenReady,
          notes: line.notes,
        },
      });
      if (line.modifiers.length > 0) {
        await tx.orderLineModifier.createMany({
          data: line.modifiers.map((m) => ({
            id: newId(),
            tenantId,
            orderLineId: voidedLineId,
            modifierId: m.modifierId,
            nameSnapshot: m.nameSnapshot,
            priceDeltaPaisa: m.priceDeltaPaisa,
          })),
        });
      }
    } else {
      await tx.orderLine.update({ where: { id: line.id }, data: { isVoided: true } });
    }

    const saved = await tx.order.update({ where: { id: order.id }, data: { ...totals, version: { increment: 1 } } });
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId: order.id,
        type: "LINE_VOIDED",
        actorId,
        payload: {
          orderLineId: voidedLineId,
          name: line.nameSnapshot,
          quantity,
          valuePaisa,
          reason: input.reason,
          // Voided after the kitchen had it: the food may already be made, which is a different
          // conversation from taking an item off a bill before anyone started on it.
          afterKitchen: order.sentToKitchenAt !== null,
        },
      },
    });
    return saved;
  });

  await announce(tenantId, branchId, order, "order_updated");
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Dine-in <-> takeaway
// ---------------------------------------------------------------------------------------------

const SWITCHABLE = ["DINE_IN", "TAKEAWAY"] as const;
type SwitchableType = (typeof SWITCHABLE)[number];

/**
 * A table that decides to take the rest away, or a takeaway that sits down after all.
 *
 * Only between dine-in and takeaway. A delivery needs an address, a customer and a rider flow that
 * a type switch has no way to supply, so it is refused rather than half-done. Service charge and tax
 * can differ by type, so the order is priced again as its new type.
 */
export async function changeOrderType(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { orderId: string; type: SwitchableType; tableId?: string }
) {
  const order = await loadOrder(tenantId, branchId, input.orderId);
  assertChangeable(order, "changed");
  if (!(SWITCHABLE as readonly string[]).includes(order.type)) {
    throw new HttpError(400, "Only dine-in and takeaway orders can be switched between the two.");
  }
  if (order.type === input.type) {
    throw new HttpError(400, `Order #${order.orderNumber} is already ${input.type === "DINE_IN" ? "dine-in" : "takeaway"}.`);
  }

  let tableLabel: string | null = null;
  if (input.type === "DINE_IN") {
    if (!input.tableId) throw new HttpError(400, "Pick the table they're sitting at.");
    const table = await tenantDb(tenantId).restaurantTable.findFirst({
      where: { id: input.tableId, floor: { branchId } },
      select: { id: true, label: true },
    });
    if (!table) throw new HttpError(404, "That table doesn't exist.");
    if (await findOpenOrderForTable(tenantId, table.id)) {
      throw new HttpError(409, `Table ${table.label} already has an open order.`);
    }
    tableLabel = table.label;
  }

  const newType = input.type;
  const totals = await provisionalTotals(tenantId, branchId, { ...order, type: newType }, order.lines);
  const oldTableId = order.tableId;
  const newTableId = newType === "DINE_IN" ? input.tableId! : null;

  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    await guardVersion(tx, order);
    const saved = await tx.order.update({
      where: { id: order.id },
      data: { ...totals, type: newType, tableId: newTableId, version: { increment: 1 } },
    });
    if (oldTableId) await tx.restaurantTable.update({ where: { id: oldTableId }, data: { status: "AVAILABLE" } });
    if (newTableId) await tx.restaurantTable.update({ where: { id: newTableId }, data: { status: "OCCUPIED" } });
    await tx.orderEvent.create({
      data: { tenantId, orderId: order.id, type: "TYPE_CHANGED", actorId, payload: { from: order.type, to: newType, table: tableLabel } },
    });
    return saved;
  });

  if (oldTableId) await publish(tenantId, branchId, "tables", "table_status_changed", { tableId: oldTableId, status: "AVAILABLE" });
  if (newTableId) await publish(tenantId, branchId, "tables", "table_status_changed", { tableId: newTableId, status: "OCCUPIED" });
  await announce(tenantId, branchId, order, "order_updated");
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Merge two tables
// ---------------------------------------------------------------------------------------------

const KITCHEN_RANK: Record<string, number> = { SENT_TO_KITCHEN: 1, READY: 2, SERVED: 3 };

/**
 * Two tables pushed together, one bill: every item on `sourceOrderId` moves onto `targetOrderId`,
 * the source table is freed, and the source order is closed with a note of where its items went.
 *
 * Refused when either order has a discount on the whole bill, because merging would silently change
 * it — a percentage would now apply to the other table's food, a fixed amount would not. And refused
 * when only one is tax exempt, for the same reason. In both cases the cashier settles them apart.
 *
 * Kitchen state: if either order has been to the kitchen, the merged one has, and it takes the least
 * finished state of the two — a table whose food is served, merged with one still cooking, is still
 * cooking.
 */
export async function mergeOrders(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { targetOrderId: string; sourceOrderId: string }
) {
  if (input.targetOrderId === input.sourceOrderId) throw new HttpError(400, "Pick a different table to merge in.");
  const [target, source] = await Promise.all([
    loadOrder(tenantId, branchId, input.targetOrderId),
    loadOrder(tenantId, branchId, input.sourceOrderId),
  ]);
  assertChangeable(target, "merged");
  assertChangeable(source, "merged");
  if (target.type !== "DINE_IN" || source.type !== "DINE_IN") {
    throw new HttpError(400, "Only dine-in tables can be merged.");
  }
  if (target.discounts.length > 0 || source.discounts.length > 0) {
    throw new HttpError(400, "One of these bills has a discount on it. Merging would change that discount, so settle them separately.");
  }
  if ((target.taxExemptReason === null) !== (source.taxExemptReason === null)) {
    throw new HttpError(400, "Only one of these bills is tax exempt, so they can't share a bill.");
  }

  const merged = [...target.lines, ...source.lines];
  const totals = await provisionalTotals(tenantId, branchId, target, merged);

  const sent = [target, source].filter((o) => o.sentToKitchenAt !== null);
  const kitchen = sent.length === 0
    ? {}
    : (() => {
        const least = sent.reduce((a, b) => ((KITCHEN_RANK[a.status] ?? 1) <= (KITCHEN_RANK[b.status] ?? 1) ? a : b));
        const status = least.status === "OPEN" ? "SENT_TO_KITCHEN" : least.status;
        return {
          status: status as "SENT_TO_KITCHEN" | "READY" | "SERVED",
          sentToKitchenAt: new Date(Math.min(...sent.map((o) => o.sentToKitchenAt!.getTime()))),
          readyAt: status === "SENT_TO_KITCHEN" ? null : least.readyAt,
          servedAt: status === "SERVED" ? least.servedAt : null,
        };
      })();

  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    await guardVersion(tx, target);
    await guardVersion(tx, source);
    await tx.orderLine.updateMany({ where: { orderId: source.id }, data: { orderId: target.id } });
    const saved = await tx.order.update({
      where: { id: target.id },
      data: {
        ...totals,
        ...kitchen,
        customerId: target.customerId ?? source.customerId,
        version: { increment: 1 },
      },
    });
    // Closed as CANCELLED so every screen already treats it as finished, with totals at zero so no
    // report can count its food twice. Deliberately no OrderCancellation row: nothing was refused
    // or sent back, and a manager's cancellation queue is for things that need looking at.
    await tx.order.update({
      where: { id: source.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        subtotalPaisa: 0,
        discountedSubtotalPaisa: 0,
        serviceChargePaisa: 0,
        taxPaisa: 0,
        roundingAdjustmentPaisa: 0,
        totalPaisa: 0,
        version: { increment: 1 },
      },
    });
    if (source.tableId) await tx.restaurantTable.update({ where: { id: source.tableId }, data: { status: "AVAILABLE" } });
    // Requests waiting for the counter (src/server/order-approvals.ts) follow the bill. A held round
    // moves with it. A held new order is decided by the merge itself, which is a counter action:
    // approved if the combined bill is in the kitchen (its food is going there now), otherwise
    // closed, pointing at the order it joined.
    await tx.orderApproval.updateMany({
      where: { orderId: source.id, status: "PENDING", kind: "MORE_ITEMS" },
      data: { orderId: target.id },
    });
    const decidedAt = new Date();
    if (saved.status !== "OPEN") {
      await tx.orderApproval.updateMany({
        where: { orderId: { in: [source.id, target.id] }, status: "PENDING", kind: "NEW_ORDER" },
        data: { status: "APPROVED", decidedById: actorId, decidedAt },
      });
    } else {
      await tx.orderApproval.updateMany({
        where: { orderId: source.id, status: "PENDING", kind: "NEW_ORDER" },
        data: { status: "REJECTED", decidedById: actorId, decidedAt, rejectReason: `Merged into order #${target.orderNumber}` },
      });
    }
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId: target.id,
        type: "MERGED_FROM",
        actorId,
        payload: { orderId: source.id, orderNumber: source.orderNumber, table: source.table?.label ?? null },
      },
    });
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId: source.id,
        type: "MERGED_INTO",
        actorId,
        payload: { orderId: target.id, orderNumber: target.orderNumber, table: target.table?.label ?? null },
      },
    });
    return saved;
  });

  if (source.tableId) await publish(tenantId, branchId, "tables", "table_status_changed", { tableId: source.tableId, status: "AVAILABLE" });
  await announce(tenantId, branchId, target, "order_updated");
  await publish(tenantId, branchId, "kds", "order_cancelled", { orderId: source.id });
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Tax exemption
// ---------------------------------------------------------------------------------------------

/**
 * Sets or clears an order's tax exemption. `reason` null clears it. While set, the order is priced
 * with no tax at every step — the bill, the payment preview, payment itself — through
 * getBranchPricingContext's taxExempt flag, so no screen can show tax the payment won't charge.
 */
export async function setTaxExemption(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { orderId: string; reason: string | null }
) {
  const order = await loadOrder(tenantId, branchId, input.orderId);
  assertChangeable(order, "changed");
  const reason = input.reason?.trim() || null;
  if (order.taxExemptReason === reason) return order;

  const totals = await provisionalTotals(tenantId, branchId, { ...order, taxExemptReason: reason }, order.lines);
  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    await guardVersion(tx, order);
    const saved = await tx.order.update({
      where: { id: order.id },
      data: {
        ...totals,
        taxExemptReason: reason,
        taxExemptById: reason ? actorId : null,
        version: { increment: 1 },
      },
    });
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId: order.id,
        type: reason ? "TAX_EXEMPTED" : "TAX_EXEMPTION_REMOVED",
        actorId,
        payload: reason ? { reason } : { previousReason: order.taxExemptReason },
      },
    });
    return saved;
  });

  await publish(tenantId, branchId, "orders", "order_updated", { orderId: order.id });
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Kitchen recall
// ---------------------------------------------------------------------------------------------

/**
 * Brings a bumped order back onto the kitchen screen — marked ready by a slip of the finger, or a
 * dish sent back. A paid order stays paid; only its kitchen state is reopened.
 */
export async function recallOrder(tenantId: string, branchId: string, actorId: string, orderId: string) {
  const order = await loadOrder(tenantId, branchId, orderId);
  if (order.status === "VOIDED" || order.status === "CANCELLED" || order.status === "DELIVERED") {
    throw new HttpError(409, `Order #${order.orderNumber} is ${order.status.toLowerCase()}, so there's nothing to bring back.`);
  }
  if (!order.sentToKitchenAt) throw new HttpError(400, `Order #${order.orderNumber} never went to the kitchen.`);
  if (!order.readyAt && order.status !== "SERVED") {
    throw new HttpError(400, `Order #${order.orderNumber} is still on the kitchen screen.`);
  }

  const updated = await tenantDb(tenantId).order.update({
    where: { id: order.id },
    data: {
      readyAt: null,
      servedAt: null,
      ...(order.status === "READY" || order.status === "SERVED" ? { status: "SENT_TO_KITCHEN" as const } : {}),
      version: { increment: 1 },
    },
  });
  await tenantDb(tenantId).orderEvent.create({ data: { tenantId, orderId: order.id, type: "RECALLED", actorId } });
  await publish(tenantId, branchId, "kds", "order_sent_to_kitchen", { orderId: order.id });
  await publish(tenantId, branchId, "orders", "order_updated", { orderId: order.id });
  return updated;
}

/** What the kitchen could bring back: orders bumped in the last three hours, newest first. */
export async function recentlyBumped(tenantId: string, branchId: string) {
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const orders = await tenantDb(tenantId).order.findMany({
    where: {
      branchId,
      readyAt: { gte: since },
      status: { notIn: ["VOIDED", "CANCELLED", "DELETED", "DELIVERED"] },
    },
    orderBy: { readyAt: "desc" },
    take: 20,
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      readyAt: true,
      table: { select: { label: true } },
      lines: { where: { isVoided: false }, select: { nameSnapshot: true, quantity: true } },
    },
  });
  return orders;
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

/**
 * Refuses a change if the order moved on since it was read — another till paid it, or voided it, in
 * the moment between. Each change reads the order, prices it, then writes; without this, a payment
 * landing in that gap would be overwritten by totals worked out from the order as it was before.
 */
async function guardVersion(tx: TenantTransactionClient, order: { id: string; version: number; orderNumber: number }) {
  const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { version: true, status: true } });
  if (fresh.version !== order.version) {
    throw new HttpError(409, `Order #${order.orderNumber} was just changed on another screen. Open it again and retry.`);
  }
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(fresh.status)) {
    throw new HttpError(409, `Order #${order.orderNumber} is already ${fresh.status.toLowerCase()}.`);
  }
}

async function announce(tenantId: string, branchId: string, order: StoredOrder, event: string) {
  await publish(tenantId, branchId, "orders", event, { orderId: order.id });
  if (order.sentToKitchenAt) await publish(tenantId, branchId, "kds", "order_sent_to_kitchen", { orderId: order.id });
}
