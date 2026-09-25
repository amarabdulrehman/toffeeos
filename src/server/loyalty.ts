import "server-only";
import { runInTenantTransaction, tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { publish } from "@/server/realtime";
import { TERMINAL_ORDER_STATUSES } from "@/server/orders";
import { provisionalTotals } from "@/server/order-changes";
import { recordPoints } from "@/server/loyalty-ledger";

/**
 * Loyalty points: earned on paid bills, spent as money off a later one.
 *
 * Off until an owner turns it on (LoyaltyProgram.isEnabled), with two numbers they choose: points
 * per Rs 100 spent, and what a point is worth when spent. Customer.loyaltyPoints is the balance;
 * LoyaltyTransaction is the ledger behind it, and every change writes both in one transaction so
 * they can never disagree.
 *
 * - Earning happens inside payment's own transaction, so a payment that rolls back earns nothing.
 * - A refund takes back the points its share of the bill earned. The balance may go below zero if
 *   they were already spent; the alternative — earn, spend, refund, keep — is how a scheme is gamed.
 * - Spending is a discount on the order, marked with how many points it used, so voiding or
 *   cancelling the order gives them back. It goes around the branch's discount ceiling on purpose:
 *   the customer earned this, it is not a cashier's discretion.
 */

export const DEFAULT_PROGRAM = { isEnabled: false, pointsPerHundredRupees: 1, paisaPerPoint: 100 };

export async function getProgram(tenantId: string) {
  const row = await tenantDb(tenantId).loyaltyProgram.findUnique({ where: { tenantId } });
  return row ?? { tenantId, ...DEFAULT_PROGRAM, updatedAt: null };
}

export async function saveProgram(
  tenantId: string,
  input: { isEnabled: boolean; pointsPerHundredRupees: number; paisaPerPoint: number }
) {
  if (input.pointsPerHundredRupees < 0 || input.pointsPerHundredRupees > 100) {
    throw new HttpError(400, "Points per Rs 100 should be between 0 and 100.");
  }
  if (input.paisaPerPoint < 1 || input.paisaPerPoint > 100_000) {
    throw new HttpError(400, "A point should be worth between 1 paisa and Rs 1,000.");
  }
  return tenantDb(tenantId).loyaltyProgram.upsert({
    where: { tenantId },
    create: { tenantId, ...input },
    update: input,
  });
}

/** Spend a customer's points on an unpaid order, as money off it. */
export async function redeemOnOrder(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: { orderId: string; points: number }
) {
  if (!Number.isInteger(input.points) || input.points < 1) throw new HttpError(400, "Spend at least one point.");
  const db = tenantDb(tenantId);
  const [program, order] = await Promise.all([
    getProgram(tenantId),
    db.order.findFirst({ where: { id: input.orderId, branchId }, include: { lines: true, discounts: true, customer: true } }),
  ]);
  if (!program.isEnabled) throw new HttpError(400, "Loyalty points aren't switched on for this restaurant.");
  if (!order) throw new HttpError(404, "That order doesn't exist.");
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new HttpError(409, `Order #${order.orderNumber} is already ${order.status.toLowerCase()}.`);
  }
  if (!order.customer) throw new HttpError(400, "Add the customer to the order first — the points are theirs.");
  if (order.discounts.length > 0) throw new HttpError(400, "This order already has a discount. Points can't be added on top of it.");
  if (order.customer.loyaltyPoints < input.points) {
    throw new HttpError(400, `${order.customer.name ?? "This customer"} has ${order.customer.loyaltyPoints} points.`);
  }

  const valuePaisa = input.points * program.paisaPerPoint;
  const subtotal = order.lines.filter((l) => !l.isVoided).reduce((s, l) => s + l.lineTotalPaisa, 0);
  if (valuePaisa > subtotal) {
    throw new HttpError(400, `That is worth more than the bill. Use at most ${Math.floor(subtotal / program.paisaPerPoint)} points.`);
  }

  const discount = { type: "FIXED" as const, value: valuePaisa };
  const totals = await provisionalTotals(tenantId, branchId, { ...order, discounts: [discount] }, order.lines);

  const updated = await runInTenantTransaction(tenantId, async (tx) => {
    const fresh = await tx.customer.findUniqueOrThrow({ where: { id: order.customer!.id }, select: { loyaltyPoints: true } });
    if (fresh.loyaltyPoints < input.points) throw new HttpError(409, "Those points were just spent elsewhere.");
    await tx.orderDiscount.create({
      data: {
        tenantId,
        orderId: order.id,
        type: "FIXED",
        value: valuePaisa,
        reason: `Loyalty: ${input.points} points`,
        appliedById: actorId,
        loyaltyPointsRedeemed: input.points,
      },
    });
    await recordPoints(tx, tenantId, { customerId: order.customer!.id, orderId: order.id, kind: "REDEEM", points: -input.points, actorId });
    const saved = await tx.order.update({ where: { id: order.id }, data: { ...totals, version: { increment: 1 } } });
    await tx.orderEvent.create({
      data: { tenantId, orderId: order.id, type: "LOYALTY_REDEEMED", actorId, payload: { points: input.points, valuePaisa } },
    });
    return saved;
  });

  await publish(tenantId, branchId, "orders", "order_updated", { orderId: order.id });
  return updated;
}

/** A manual correction — a goodwill gesture, or points that should have been earned and weren't. */
export async function adjustPoints(tenantId: string, actorId: string, input: { customerId: string; points: number; reason: string }) {
  if (!Number.isInteger(input.points) || input.points === 0) throw new HttpError(400, "Adjust by a whole number of points, up or down.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new HttpError(400, "Say why the points are being changed.");
  const customer = await tenantDb(tenantId).customer.findFirst({ where: { id: input.customerId } });
  if (!customer) throw new HttpError(404, "That customer doesn't exist.");
  return runInTenantTransaction(tenantId, (tx) =>
    recordPoints(tx, tenantId, { customerId: customer.id, kind: "ADJUST", points: input.points, reason, actorId })
  );
}

export async function pointsHistory(tenantId: string, customerId: string) {
  return tenantDb(tenantId).loyaltyTransaction.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
