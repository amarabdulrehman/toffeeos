import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { newOrderId, newOrderLineId, newId } from "@/lib/ids";
import { publish } from "@/server/realtime";
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

export interface CreateOrderLineInput {
  menuItemId: string;
  variantId?: string;
  modifierIds?: string[];
  quantity: number;
  notes?: string;
  discount?: DiscountInput;
}

export interface CreateOrderInput {
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
  tableId?: string;
  customerId?: string;
  lines: CreateOrderLineInput[];
  orderDiscount?: DiscountInput;
  idempotencyKey: string;
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
    if (!menuItem) throw new Error(`Unknown menu item: ${line.menuItemId}`);
    const override = overrideByMenuItemId.get(line.menuItemId);
    if (override && !override.isAvailable) {
      throw new Error(`${menuItem.name} is not available at this branch right now.`);
    }

    const basePrice = override?.priceOverridePaisa ?? menuItem.basePricePaisa;
    const variant = line.variantId ? variantById.get(line.variantId) : undefined;
    const variantDelta = variant?.priceDeltaPaisa ?? 0;

    const resolvedModifiers = (line.modifierIds ?? []).map((modifierId) => {
      const modifier = modifierById.get(modifierId);
      if (!modifier) throw new Error(`Unknown modifier: ${modifierId}`);
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
export async function createOrder(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: CreateOrderInput
) {
  const existing = await tenantDb(tenantId).order.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const resolvedLines = await resolveLines(tenantId, branchId, input.lines);
  const { settings, taxRules } = await getBranchPricingContext(tenantId, branchId, input.type);
  const totals = computeProvisionalTotal(toPricingLines(resolvedLines), input.orderDiscount, taxRules, settings);

  const orderId = newOrderId();

  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_RETRIES; attempt++) {
    try {
      const order = await runInTenantTransaction(tenantId, async (tx) => {
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

        return order;
      });

      if (input.tableId) {
        await publish(tenantId, branchId, "tables", "table_status_changed", {
          tableId: input.tableId,
          status: "OCCUPIED",
        });
      }
      return order;
    } catch (err) {
      const isOrderNumberClash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (isOrderNumberClash && attempt < MAX_ORDER_NUMBER_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate an order number — please retry.");
}

export async function sendToKitchen(tenantId: string, branchId: string, orderId: string, actorId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.update({
    where: { id: orderId },
    data: { status: "SENT_TO_KITCHEN", sentToKitchenAt: new Date() },
    include: { lines: { include: { modifiers: true } } },
  });
  await db.orderEvent.create({ data: { tenantId, orderId, type: "SENT_TO_KITCHEN", actorId } });
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
 * estimate the cart showed while building. */
export async function takePayment(
  tenantId: string,
  branchId: string,
  orderId: string,
  actorId: string,
  input: TakePaymentInput
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

  return runInTenantTransaction(tenantId, async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId, tenantId },
      data: {
        status: "PAID",
        paidAt: new Date(),
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

    return updated;
  }).then(async (updated) => {
    await publish(tenantId, branchId, "orders", "order_paid", { orderId });
    if (order.tableId) {
      await publish(tenantId, branchId, "tables", "table_status_changed", {
        tableId: order.tableId,
        status: "AVAILABLE",
      });
    }
    return updated;
  });
}

export async function voidOrder(tenantId: string, branchId: string, orderId: string, actorId: string, reason?: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.update({ where: { id: orderId }, data: { status: "VOIDED", voidedAt: new Date() } });
  await db.orderEvent.create({ data: { tenantId, orderId, type: "VOIDED", actorId, payload: { reason } } });
  if (order.tableId) {
    await db.restaurantTable.update({ where: { id: order.tableId }, data: { status: "AVAILABLE" } });
    await publish(tenantId, branchId, "tables", "table_status_changed", {
      tableId: order.tableId,
      status: "AVAILABLE",
    });
  }
  await publish(tenantId, branchId, "orders", "order_voided", { orderId });
  return order;
}
