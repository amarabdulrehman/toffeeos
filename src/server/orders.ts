import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { runInTenantTransaction, tenantDb, type TenantTransactionClient } from "@/server/db";
import { newOrderId, newOrderLineId, newId } from "@/lib/ids";
import { publish } from "@/server/realtime";
import { HttpError } from "@/server/handler";
import { deductForOrder } from "@/server/recipes";
import { recordConflict } from "@/server/sync-conflicts";
import { notifyLowStock } from "@/server/whatsapp/triggers";
import {
  computeProvisionalTotal,
  finalizeOrder,
  type DiscountInput,
  type PaymentMethodKey,
  type PricingLineInput,
  type PricingSettings,
  type TaxRuleInput,
  type TenderInput,
} from "@/lib/pricing";

/** Statuses where the order is done — never occupying its table, never payable/voidable again.
 * Shared by createOrder's table-conflict check, takePayment's double-pay guard, and voidOrder's
 * double-void guard, so the definition of "closed" can't drift between the three. */
export const TERMINAL_ORDER_STATUSES = ["PAID", "DELIVERED", "VOIDED", "CANCELLED"] as const;

/**
 * Makes a mutating order action (send-to-kitchen, pay, void) safe to replay: the offline sync
 * queue retries an action whenever it's unsure the previous attempt landed (a flaky reconnect, a
 * response that never arrived). Without this, a retried "pay" or "void" would run its business
 * logic — and its realtime publish, and its stock deduction — a second time.
 *
 * actionId is claimed with its own small write, deliberately outside the transaction fn() runs
 * in: catching a unique-constraint error inside an interactive transaction leaves the underlying
 * Postgres transaction in an aborted state until COMMIT, which is easy to get subtly wrong. The
 * tradeoff is a narrow window — a crash between claiming actionId and fn() completing — where a
 * retried action would be (wrongly) treated as already-applied. Acceptable for this feature: a
 * server crash mid-request is rare, and the discrepancy is visible in the order queue / Sync
 * Conflicts screen for a manager to catch, rather than silently corrupting state on every retry.
 */
async function withActionIdempotency<T>(
  tenantId: string,
  actionId: string | undefined,
  actionType: string,
  orderId: string,
  fn: (tx: TenantTransactionClient) => Promise<T>,
  /** Distinguishes "the action actually applied" from "a conflict was recorded instead, nothing
   * changed" — takePayment/voidOrder return {ok: false} for the latter. If the action didn't
   * apply, its actionId claim is released, so a later replay re-attempts (and can re-evaluate the
   * conflict against then-current state) instead of being told it already succeeded. */
  isApplied: (result: T) => boolean,
  onAlreadyApplied: () => Promise<T>
): Promise<T> {
  if (!actionId) {
    // No actionId supplied (a normal online call, not an offline-queue replay) — run once, no
    // idempotency bookkeeping needed.
    return runInTenantTransaction(tenantId, fn);
  }

  try {
    await tenantDb(tenantId).syncActionLog.create({ data: { tenantId, actionId, actionType, orderId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return onAlreadyApplied();
    }
    throw err;
  }

  const result = await runInTenantTransaction(tenantId, fn);
  if (!isApplied(result)) {
    await tenantDb(tenantId).syncActionLog.deleteMany({ where: { tenantId, actionId } });
  }
  return result;
}

export interface CreateOrderLineInput {
  menuItemId: string;
  variantId?: string;
  modifierIds?: string[];
  quantity: number;
  notes?: string;
  discount?: DiscountInput;
}

export interface CreateOrderInput {
  /** Client-generated ULID (src/lib/ids.ts newOrderId()) — the whole point is that the offline POS
   * knows the order's final id before it ever reaches the network, so later queued actions (pay,
   * void) can target it immediately. Falls back to server generation for any caller that doesn't
   * supply one (e.g. a future non-POS integration). */
  id?: string;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
  tableId?: string;
  customerId?: string;
  lines: CreateOrderLineInput[];
  orderDiscount?: DiscountInput;
  idempotencyKey: string;
  /** Defaults to POS — the online ordering site and QR table ordering pass ONLINE/QR so staff can
   * tell at a glance where an order came from (src/components/pos/order-queue-panel.tsx). */
  source?: "POS" | "ONLINE" | "QR";
  /** DELIVERY-type orders only. A plain snapshot, not linked to CustomerAddress — see the schema
   * comment on Order.deliveryAddress. */
  deliveryAddress?: string;
}

/** Loads a branch's pricing configuration (service charge, rounding, tax rules) in the shape
 * src/lib/pricing.ts expects. */
export async function getBranchPricingContext(
  tenantId: string,
  branchId: string,
  orderType: CreateOrderInput["type"]
): Promise<{ settings: PricingSettings; taxRules: TaxRuleInput[] }> {
  const db = tenantDb(tenantId);
  const [branchSettings, taxRules] = await Promise.all([
    db.branchSettings.findUnique({ where: { branchId } }),
    db.taxRule.findMany({ where: { branchId, isActive: true } }),
  ]);

  const settings: PricingSettings = {
    serviceChargeBasisPoints: branchSettings?.serviceChargeBasisPoints ?? 0,
    serviceChargeApplies: (branchSettings?.serviceChargeAppliesTo ?? ["DINE_IN"]).includes(orderType),
    serviceChargeTaxable: branchSettings?.serviceChargeTaxable ?? true,
    roundingMode: branchSettings?.roundingMode ?? "NEAREST_1",
  };

  return {
    settings,
    taxRules: taxRules.map((r) => ({
      paymentMethods: r.paymentMethods as PaymentMethodKey[],
      rateBasisPoints: r.rateBasisPoints,
      isActive: r.isActive,
    })),
  };
}

interface ResolvedLine extends CreateOrderLineInput {
  id: string;
  nameSnapshot: string;
  unitPricePaisa: number;
  modifiers: { id: string; modifierId: string; nameSnapshot: string; priceDeltaPaisa: number }[];
}

/** Resolves each line's per-unit price from current menu data (base price ± branch override ±
 * variant delta + sum of modifier deltas) and snapshots the display name, so a later menu edit
 * never changes what a historical order shows or how it was priced. */
async function resolveLines(
  tenantId: string,
  branchId: string,
  lines: CreateOrderLineInput[]
): Promise<ResolvedLine[]> {
  const db = tenantDb(tenantId);
  const menuItemIds = [...new Set(lines.map((l) => l.menuItemId))];

  const [menuItems, branchOverrides, variants, modifiers] = await Promise.all([
    db.menuItem.findMany({ where: { id: { in: menuItemIds } } }),
    db.branchMenuItem.findMany({ where: { branchId, menuItemId: { in: menuItemIds } } }),
    db.itemVariant.findMany({ where: { menuItemId: { in: menuItemIds } } }),
    db.modifier.findMany({}),
  ]);

  const menuItemById = new Map(menuItems.map((m) => [m.id, m]));
  const overrideByMenuItemId = new Map(branchOverrides.map((o) => [o.menuItemId, o]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const modifierById = new Map(modifiers.map((m) => [m.id, m]));

  return lines.map((line) => {
    const menuItem = menuItemById.get(line.menuItemId);
    if (!menuItem) throw new HttpError(400, `Unknown menu item: ${line.menuItemId}`);
    const override = overrideByMenuItemId.get(line.menuItemId);
    if (override && !override.isAvailable) {
      throw new HttpError(400, `${menuItem.name} is not available at this branch right now.`);
    }

    const basePrice = override?.priceOverridePaisa ?? menuItem.basePricePaisa;
    const variant = line.variantId ? variantById.get(line.variantId) : undefined;
    const variantDelta = variant?.priceDeltaPaisa ?? 0;

    const resolvedModifiers = (line.modifierIds ?? []).map((modifierId) => {
      const modifier = modifierById.get(modifierId);
      if (!modifier) throw new HttpError(400, `Unknown modifier: ${modifierId}`);
      return {
        id: newId(),
        modifierId,
        nameSnapshot: modifier.name,
        priceDeltaPaisa: modifier.priceDeltaPaisa,
      };
    });
    const modifierTotal = resolvedModifiers.reduce((a, m) => a + m.priceDeltaPaisa, 0);

    return {
      ...line,
      id: newOrderLineId(),
      nameSnapshot: variant ? `${menuItem.name} (${variant.name})` : menuItem.name,
      unitPricePaisa: basePrice + variantDelta + modifierTotal,
      modifiers: resolvedModifiers,
    };
  });
}

function toPricingLines(resolved: ResolvedLine[]): PricingLineInput[] {
  return resolved.map((l) => ({
    id: l.id,
    unitPricePaisa: l.unitPricePaisa,
    quantity: l.quantity,
    discount: l.discount,
  }));
}

const MAX_ORDER_NUMBER_RETRIES = 3;

/**
 * Creates an order in OPEN status with provisional totals (see computeProvisionalTotal — tax is
 * shown at the cash rate until payment, then recomputed exactly by finalizeOrderPayment).
 * idempotencyKey makes a retried submission (e.g. an offline POS reconnecting) a no-op rather than
 * a duplicate order — see the unique constraint on [tenantId, idempotencyKey].
 */
/** actorId is null for customer-placed orders (online ordering, QR) — there's no staff member to
 * attribute createdById/OrderEvent.actorId to, and both columns are nullable for exactly this. */
export async function createOrder(
  tenantId: string,
  branchId: string,
  actorId: string | null,
  input: CreateOrderInput
) {
  const existing = await tenantDb(tenantId).order.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const resolvedLines = await resolveLines(tenantId, branchId, input.lines);
  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, input.type);
  const totals = computeProvisionalTotal(toPricingLines(resolvedLines), input.orderDiscount, taxRules, settings);

  const orderId = input.id ?? newOrderId();

  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_RETRIES; attempt++) {
    try {
      const result = await runInTenantTransaction(tenantId, async (tx) => {
        // The offline-sync conflict this guards against: two devices, both offline, both start a
        // dine-in order for the same table without realizing the other already has. Checked and
        // resolved inside this transaction (not before it) so it's atomic with orderNumber
        // allocation — a genuinely simultaneous request from two devices can't both pass this
        // check and then also both win the orderNumber race.
        if (input.tableId && input.type === "DINE_IN") {
          const conflicting = await tx.order.findFirst({
            where: { tableId: input.tableId, status: { notIn: [...TERMINAL_ORDER_STATUSES] }, NOT: { idempotencyKey: input.idempotencyKey } },
          });
          if (conflicting) {
            await recordConflict(tx, {
              tenantId,
              branchId,
              kind: "TABLE_DOUBLE_ORDER",
              tableId: input.tableId,
              conflictingOrderId: conflicting.id,
              actionType: "createOrder",
              devicePayload: { idempotencyKey: input.idempotencyKey, attemptedOrderId: orderId, lines: input.lines },
              serverSnapshot: { conflictingOrderId: conflicting.id, conflictingOrderNumber: conflicting.orderNumber, conflictingOrderStatus: conflicting.status },
            });
            return { ok: false as const };
          }
        }

        const last = await tx.order.aggregate({ where: { branchId }, _max: { orderNumber: true } });
        const orderNumber = (last._max.orderNumber ?? 0) + 1;

        const order = await tx.order.create({
          data: {
            id: orderId,
            tenantId,
            branchId,
            idempotencyKey: input.idempotencyKey,
            tableId: input.tableId,
            customerId: input.customerId,
            createdById: actorId,
            orderNumber,
            type: input.type,
            status: "OPEN",
            source: input.source ?? "POS",
            deliveryAddress: input.deliveryAddress,
            subtotalPaisa: totals.subtotalPaisa,
            discountedSubtotalPaisa: totals.discountedSubtotalPaisa,
            serviceChargePaisa: totals.serviceChargePaisa,
            taxPaisa: totals.taxPaisa,
            totalPaisa: totals.totalPaisa,
          },
        });

        if (input.orderDiscount) {
          await tx.orderDiscount.create({
            data: {
              tenantId,
              orderId,
              type: input.orderDiscount.type,
              value: input.orderDiscount.value,
              appliedById: actorId,
            },
          });
        }

        for (const line of resolvedLines) {
          await tx.orderLine.create({
            data: {
              id: line.id,
              tenantId,
              orderId,
              menuItemId: line.menuItemId,
              variantId: line.variantId,
              nameSnapshot: line.nameSnapshot,
              unitPricePaisa: line.unitPricePaisa,
              quantity: line.quantity,
              discountType: line.discount?.type,
              discountValue: line.discount?.value,
              lineTotalPaisa: line.unitPricePaisa * line.quantity,
              notes: line.notes,
            },
          });
          if (line.modifiers.length > 0) {
            await tx.orderLineModifier.createMany({
              data: line.modifiers.map((m) => ({
                id: m.id,
                tenantId,
                orderLineId: line.id,
                modifierId: m.modifierId,
                nameSnapshot: m.nameSnapshot,
                priceDeltaPaisa: m.priceDeltaPaisa,
              })),
            });
          }
        }

        await tx.orderEvent.create({
          data: { tenantId, orderId, type: "PUNCHED", actorId },
        });

        if (input.tableId) {
          await tx.restaurantTable.update({ where: { id: input.tableId, tenantId }, data: { status: "OCCUPIED" } });
        }

        return { ok: true as const, order };
      });

      if (!result.ok) {
        throw new HttpError(
          409,
          "This table already has an open order from another device. A manager needs to resolve this before a new order can be placed.",
          { code: "SYNC_CONFLICT", kind: "TABLE_DOUBLE_ORDER" }
        );
      }

      if (input.tableId) {
        await publish(tenantId, branchId, "tables", "table_status_changed", {
          tableId: input.tableId,
          status: "OCCUPIED",
        });
      }
      return result.order;
    } catch (err) {
      const isOrderNumberClash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (isOrderNumberClash && attempt < MAX_ORDER_NUMBER_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate an order number — please retry.");
}

/** The table's currently-open order, if any — "open" meaning not yet PAID/VOIDED/CANCELLED/
 * DELIVERED, same terminal-status definition used everywhere else. QR table ordering
 * (src/server/online-ordering.ts) uses this to decide whether a guest's order should attach to
 * what's already there or start a fresh one, instead of ever creating a second competing order
 * for an occupied table. */
export async function findOpenOrderForTable(tenantId: string, tableId: string) {
  const db = tenantDb(tenantId);
  return db.order.findFirst({
    where: { tableId, status: { notIn: [...TERMINAL_ORDER_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Appends lines to an order that's already been punched — the QR-ordering case of a guest adding
 * more items to a table that already has an open order. Recomputes provisional totals from every
 * non-voided line (existing + new), same pricing engine as creation. If the kitchen had already
 * marked the order READY, this bumps it back to SENT_TO_KITCHEN — there's now unprepared food
 * against it — rather than leaving new items silently invisible on a "ready" ticket.
 */
export async function addLinesToOrder(
  tenantId: string,
  branchId: string,
  orderId: string,
  newLines: CreateOrderLineInput[],
  actorId: string | null
) {
  const db = tenantDb(tenantId);
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, discounts: true } });
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new HttpError(409, `This order is already ${order.status.toLowerCase()} and can't take more items.`);
  }

  const resolvedNewLines = await resolveLines(tenantId, branchId, newLines);
  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, order.type);
  const orderDiscount: DiscountInput | undefined = order.discounts[0]
    ? { type: order.discounts[0].type, value: order.discounts[0].value }
    : undefined;

  const allPricingLines: PricingLineInput[] = [
    ...order.lines.filter((l) => !l.isVoided).map((l) => ({ id: l.id, unitPricePaisa: l.unitPricePaisa, quantity: l.quantity })),
    ...toPricingLines(resolvedNewLines),
  ];
  const totals = computeProvisionalTotal(allPricingLines, orderDiscount, taxRules, settings);

  return runInTenantTransaction(tenantId, async (tx) => {
    for (const line of resolvedNewLines) {
      await tx.orderLine.create({
        data: {
          id: line.id,
          tenantId,
          orderId,
          menuItemId: line.menuItemId,
          variantId: line.variantId,
          nameSnapshot: line.nameSnapshot,
          unitPricePaisa: line.unitPricePaisa,
          quantity: line.quantity,
          discountType: line.discount?.type,
          discountValue: line.discount?.value,
          lineTotalPaisa: line.unitPricePaisa * line.quantity,
          notes: line.notes,
        },
      });
      if (line.modifiers.length > 0) {
        await tx.orderLineModifier.createMany({
          data: line.modifiers.map((m) => ({
            id: m.id,
            tenantId,
            orderLineId: line.id,
            modifierId: m.modifierId,
            nameSnapshot: m.nameSnapshot,
            priceDeltaPaisa: m.priceDeltaPaisa,
          })),
        });
      }
    }

    const wasReady = order.status === "READY";
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        subtotalPaisa: totals.subtotalPaisa,
        discountedSubtotalPaisa: totals.discountedSubtotalPaisa,
        serviceChargePaisa: totals.serviceChargePaisa,
        taxPaisa: totals.taxPaisa,
        totalPaisa: totals.totalPaisa,
        version: { increment: 1 },
        ...(wasReady ? { status: "SENT_TO_KITCHEN" as const, sentToKitchenAt: new Date() } : {}),
      },
    });

    await tx.orderEvent.create({
      data: { tenantId, orderId, type: "PUNCHED", actorId, payload: { appended: true, lineCount: resolvedNewLines.length } },
    });

    return updated;
  }).then(async (updated) => {
    if (order.status === "SENT_TO_KITCHEN" || order.status === "READY") {
      await publish(tenantId, branchId, "kds", "order_sent_to_kitchen", { orderId });
    }
    return updated;
  });
}

export async function sendToKitchen(
  tenantId: string,
  branchId: string,
  orderId: string,
  actorId: string | null,
  actionId?: string
) {
  const order = await withActionIdempotency(
    tenantId,
    actionId,
    "sendToKitchen",
    orderId,
    async (tx) => {
      const order = await tx.order.update({
        where: { id: orderId },
        data: { status: "SENT_TO_KITCHEN", sentToKitchenAt: new Date(), version: { increment: 1 } },
        include: { lines: { include: { modifiers: true } } },
      });
      await tx.orderEvent.create({ data: { tenantId, orderId, type: "SENT_TO_KITCHEN", actorId } });
      return order;
    },
    () => true,
    () => tenantDb(tenantId).order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { include: { modifiers: true } } } })
  );
  await publish(tenantId, branchId, "kds", "order_sent_to_kitchen", { orderId });
  return order;
}

export async function markLineReady(tenantId: string, branchId: string, orderLineId: string, actorId: string) {
  const db = tenantDb(tenantId);
  const line = await db.orderLine.update({ where: { id: orderLineId }, data: { kitchenReady: true } });
  await db.orderEvent.create({ data: { tenantId, orderId: line.orderId, type: "ITEM_READY", actorId, payload: { orderLineId } } });
  await publish(tenantId, branchId, "kds", "item_ready", { orderId: line.orderId, orderLineId });
  return line;
}

export async function markOrderReady(tenantId: string, branchId: string, orderId: string, actorId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.update({ where: { id: orderId }, data: { status: "READY", readyAt: new Date() } });
  await db.orderEvent.create({ data: { tenantId, orderId, type: "READY", actorId } });
  await publish(tenantId, branchId, "kds", "order_ready", { orderId });
  await publish(tenantId, branchId, "orders", "order_ready", { orderId });
  return order;
}

export async function markOrderServed(tenantId: string, branchId: string, orderId: string, actorId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.update({ where: { id: orderId }, data: { status: "SERVED", servedAt: new Date() } });
  await db.orderEvent.create({ data: { tenantId, orderId, type: "SERVED", actorId } });
  await publish(tenantId, branchId, "orders", "order_served", { orderId });
  return order;
}

export interface TakePaymentInput {
  tenders: TenderInput[];
}

/** Authoritative final pricing pass (see finalizeOrder in pricing.ts) — this is where a split
 * cash+card order actually gets its blended Punjab PRA tax rate, not just the provisional cash-rate
 * estimate the cart showed while building.
 *
 * actionId/expectedVersion are only ever sent by the offline sync queue (src/lib/offline) replaying
 * a payment taken while disconnected — a normal online tap-to-pay omits both, and this behaves
 * exactly as it did before Phase 4. expectedVersion is the order's version as last seen by the
 * device that queued this payment; if the server's version has since moved on, something else
 * (another device, another action) touched this order first, and that's a conflict for a manager,
 * not something to silently overwrite. */
export async function takePayment(
  tenantId: string,
  branchId: string,
  orderId: string,
  actorId: string,
  input: TakePaymentInput,
  actionId?: string,
  expectedVersion?: number
) {
  const db = tenantDb(tenantId);
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, discounts: true },
  });

  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, order.type);
  const pricingLines: PricingLineInput[] = order.lines.map((l) => ({
    id: l.id,
    unitPricePaisa: l.unitPricePaisa,
    quantity: l.quantity,
    isVoided: l.isVoided,
  }));
  const orderDiscount: DiscountInput | undefined = order.discounts[0]
    ? { type: order.discounts[0].type, value: order.discounts[0].value }
    : undefined;

  const totals = finalizeOrder(pricingLines, orderDiscount, taxRules, settings, input.tenders);

  const result = await withActionIdempotency(
    tenantId,
    actionId,
    "pay",
    orderId,
    async (tx) => {
      // Re-read inside the transaction rather than trusting the `order` fetched above — that read
      // happened before this transaction opened, so it can't be what decides whether this payment
      // is safe to apply.
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const isTerminal = (TERMINAL_ORDER_STATUSES as readonly string[]).includes(fresh.status);
      const isStale = expectedVersion !== undefined && fresh.version !== expectedVersion;

      if (isTerminal || isStale) {
        if (expectedVersion !== undefined) {
          // This is an offline replay landing on an order that moved on without it — genuine
          // conflict, not a user-facing "already paid" notice.
          await recordConflict(tx, {
            tenantId,
            branchId,
            kind: "STALE_ORDER_ACTION",
            orderId,
            actionType: "pay",
            devicePayload: { expectedVersion, tenders: input.tenders },
            serverSnapshot: { status: fresh.status, version: fresh.version },
          });
          return { ok: false as const };
        }
        // Plain online double-tap / retried request — the original Phase 3 guard, unchanged.
        throw new HttpError(409, `This order is already ${fresh.status.toLowerCase()} and cannot be paid again.`);
      }

      const updated = await tx.order.update({
        where: { id: orderId, tenantId },
        data: {
          status: "PAID",
          paidAt: new Date(),
          version: { increment: 1 },
          subtotalPaisa: totals.subtotalPaisa,
          discountedSubtotalPaisa: totals.discountedSubtotalPaisa,
          serviceChargePaisa: totals.serviceChargePaisa,
          taxPaisa: totals.taxPaisa,
          roundingAdjustmentPaisa: totals.roundingAdjustmentPaisa,
          totalPaisa: totals.totalPaisa,
          paidPaisa: totals.tenders.reduce((a, t) => a + t.amountPaisa, 0),
        },
      });

      for (const t of totals.tenders) {
        await tx.payment.create({
          data: {
            tenantId,
            orderId,
            method: t.method,
            amountPaisa: t.amountPaisa,
            taxRateBasisPoints: t.rateBasisPoints,
            receivedById: actorId,
          },
        });
      }

      if (order.tableId) {
        await tx.restaurantTable.update({ where: { id: order.tableId, tenantId }, data: { status: "AVAILABLE" } });
      }

      await tx.orderEvent.create({ data: { tenantId, orderId, type: "PAID", actorId } });

      // Recipe consumption happens here, not on order creation — a voided/cancelled order never
      // reaches this point, and items with no recipe defined are silently skipped (see
      // src/server/recipes.ts deductForOrder). Queued the same way as the payment itself: if the
      // "pay" action is offline, this only runs once the action replays and actually commits.
      const soldLines = order.lines.filter((l) => !l.isVoided).map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity }));
      const newAlerts = await deductForOrder(tx, tenantId, branchId, soldLines, actorId);

      return { ok: true as const, order: updated, newAlerts };
    },
    (result) => result.ok,
    () => db.order.findUniqueOrThrow({ where: { id: orderId } }).then((o) => ({ ok: true as const, order: o, newAlerts: [] }))
  );

  if (!result.ok) {
    throw new HttpError(409, "Another device already changed this order — a manager needs to resolve this before payment can be retried.", {
      code: "SYNC_CONFLICT",
      kind: "STALE_ORDER_ACTION",
    });
  }

  await publish(tenantId, branchId, "orders", "order_paid", { orderId });
  if (order.tableId) {
    await publish(tenantId, branchId, "tables", "table_status_changed", { tableId: order.tableId, status: "AVAILABLE" });
  }
  await Promise.all(result.newAlerts.map((alert) => notifyLowStock(tenantId, alert)));
  return result.order;
}

/** actionId/expectedVersion: see the note on takePayment — only ever sent by the offline sync
 * queue. Prior to Phase 4 this had no terminal-status guard at all, which meant voiding an
 * already-PAID order would silently succeed and flip it back to VOIDED — a real bug, fixed here
 * alongside the offline-replay support (a retried void is exactly the kind of double-call that
 * would have hit it). */
export async function voidOrder(
  tenantId: string,
  branchId: string,
  orderId: string,
  actorId: string,
  reason?: string,
  actionId?: string,
  expectedVersion?: number
) {
  const db = tenantDb(tenantId);

  const result = await withActionIdempotency(
    tenantId,
    actionId,
    "void",
    orderId,
    async (tx) => {
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const isTerminal = (TERMINAL_ORDER_STATUSES as readonly string[]).includes(fresh.status);
      const isStale = expectedVersion !== undefined && fresh.version !== expectedVersion;

      if (isTerminal || isStale) {
        if (expectedVersion !== undefined) {
          await recordConflict(tx, {
            tenantId,
            branchId,
            kind: "STALE_ORDER_ACTION",
            orderId,
            actionType: "void",
            devicePayload: { expectedVersion, reason },
            serverSnapshot: { status: fresh.status, version: fresh.version },
          });
          return { ok: false as const };
        }
        throw new HttpError(409, `This order is already ${fresh.status.toLowerCase()} and cannot be voided.`);
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: "VOIDED", voidedAt: new Date(), version: { increment: 1 } },
      });
      await tx.orderEvent.create({ data: { tenantId, orderId, type: "VOIDED", actorId, payload: { reason } } });
      if (updated.tableId) {
        await tx.restaurantTable.update({ where: { id: updated.tableId }, data: { status: "AVAILABLE" } });
      }
      return { ok: true as const, order: updated };
    },
    (r) => r.ok,
    () => db.order.findUniqueOrThrow({ where: { id: orderId } }).then((o) => ({ ok: true as const, order: o }))
  );

  if (!result.ok) {
    throw new HttpError(409, "Another device already changed this order — a manager needs to resolve this before it can be voided.", {
      code: "SYNC_CONFLICT",
      kind: "STALE_ORDER_ACTION",
    });
  }

  if (result.order.tableId) {
    await publish(tenantId, branchId, "tables", "table_status_changed", { tableId: result.order.tableId, status: "AVAILABLE" });
  }
  await publish(tenantId, branchId, "orders", "order_voided", { orderId });
  return result.order;
}
