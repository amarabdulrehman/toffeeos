import "server-only";
import type { TenantTransactionClient } from "@/server/db";

/**
 * The loyalty ledger's writes that payment, refunds and voids make from inside their own
 * transactions. Kept apart from src/server/loyalty.ts so src/server/orders.ts and
 * src/server/refunds.ts can call them without an import loop (loyalty.ts itself prices orders
 * through order-changes.ts, which imports orders.ts). See loyalty.ts for how the scheme works.
 */

/** Points a bill of this size earns under this programme. Whole points only, rounded down. */
export function pointsFor(totalPaisa: number, pointsPerHundredRupees: number): number {
  if (totalPaisa <= 0 || pointsPerHundredRupees <= 0) return 0;
  return Math.floor((totalPaisa * pointsPerHundredRupees) / 10_000);
}

export async function recordPoints(
  tx: TenantTransactionClient,
  tenantId: string,
  entry: { customerId: string; orderId?: string; kind: "EARN" | "REDEEM" | "ADJUST" | "REVERSE"; points: number; reason?: string; actorId?: string | null }
) {
  await tx.loyaltyTransaction.create({
    data: {
      tenantId,
      customerId: entry.customerId,
      orderId: entry.orderId,
      kind: entry.kind,
      points: entry.points,
      reason: entry.reason,
      actorId: entry.actorId ?? null,
    },
  });
  return tx.customer.update({ where: { id: entry.customerId }, data: { loyaltyPoints: { increment: entry.points } } });
}

/** Called from inside takePayment's transaction, after the order is PAID. */
export async function earnForPaidOrder(
  tx: TenantTransactionClient,
  tenantId: string,
  order: { id: string; customerId: string | null; totalPaisa: number },
  actorId: string | null
) {
  if (!order.customerId) return;
  const program = await tx.loyaltyProgram.findUnique({ where: { tenantId } });
  if (!program?.isEnabled) return;
  const points = pointsFor(order.totalPaisa, program.pointsPerHundredRupees);
  if (points <= 0) return;
  await recordPoints(tx, tenantId, { customerId: order.customerId, orderId: order.id, kind: "EARN", points, actorId });
}

/**
 * Called from inside a refund's transaction, after the order's refundedPaisa has moved. Takes back
 * the share of the bill's earned points that has now been refunded, in total — so two half refunds
 * take back the same as one full one, and rounding never lets points leak either way.
 */
export async function reverseForRefund(
  tx: TenantTransactionClient,
  tenantId: string,
  order: { id: string; customerId: string | null; totalPaisa: number; refundedPaisa: number },
  actorId: string | null
) {
  if (!order.customerId || order.totalPaisa <= 0) return;
  // Spelled out rather than `reason: { not: ... }`: in SQL that also drops every row with no reason
  // at all, which is every EARN — the reversal would then always see nothing earned.
  const entries = await tx.loyaltyTransaction.findMany({
    where: { orderId: order.id, OR: [{ kind: "EARN" }, { kind: "REVERSE", reason: "refunded" }] },
    select: { kind: true, points: true },
  });
  const earned = entries.filter((e) => e.kind === "EARN").reduce((s, e) => s + e.points, 0);
  if (earned <= 0) return;
  const alreadyTaken = -entries.filter((e) => e.kind === "REVERSE").reduce((s, e) => s + e.points, 0);
  const shouldHaveTaken = Math.floor((earned * Math.min(order.refundedPaisa, order.totalPaisa)) / order.totalPaisa);
  const takeNow = shouldHaveTaken - alreadyTaken;
  if (takeNow <= 0) return;
  await recordPoints(tx, tenantId, {
    customerId: order.customerId,
    orderId: order.id,
    kind: "REVERSE",
    points: -takeNow,
    reason: "refunded",
    actorId,
  });
}

/**
 * Called from inside a void's or cancellation's transaction: points spent on this order go back.
 * The discount row stays for the record; the order it discounted is no longer a sale.
 */
export async function giveBackRedemption(tx: TenantTransactionClient, tenantId: string, orderId: string, actorId: string | null) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true, discounts: true } });
  const spent = order.discounts.reduce((s, d) => s + (d.loyaltyPointsRedeemed ?? 0), 0);
  if (!order.customerId || spent <= 0) return;
  const given = await tx.loyaltyTransaction.findFirst({ where: { orderId, kind: "REVERSE", reason: "points given back" } });
  if (given) return;
  await recordPoints(tx, tenantId, { customerId: order.customerId, orderId, kind: "REVERSE", points: spent, reason: "points given back", actorId });
}

/**
 * A deleted order is no longer a sale, so whatever it earned and hasn't already been taken back by a
 * refund comes off the customer's balance. Separate from reverseForRefund because a deletion takes
 * the whole of it, not a share; reason "order deleted" so it can be told apart in the ledger.
 */
export async function reverseForDeletion(
  tx: TenantTransactionClient,
  tenantId: string,
  order: { id: string; customerId: string | null },
  actorId: string | null
) {
  if (!order.customerId) return;
  const entries = await tx.loyaltyTransaction.findMany({
    where: { orderId: order.id, OR: [{ kind: "EARN" }, { kind: "REVERSE", reason: { in: ["refunded", "order deleted"] } }] },
    select: { kind: true, points: true },
  });
  const earned = entries.filter((e) => e.kind === "EARN").reduce((s, e) => s + e.points, 0);
  const alreadyTaken = -entries.filter((e) => e.kind === "REVERSE").reduce((s, e) => s + e.points, 0);
  const takeNow = earned - alreadyTaken;
  if (takeNow <= 0) return;
  await recordPoints(tx, tenantId, {
    customerId: order.customerId,
    orderId: order.id,
    kind: "REVERSE",
    points: -takeNow,
    reason: "order deleted",
    actorId,
  });
}
