import "server-only";
import { tenantDb } from "@/server/db";
import { publish } from "@/server/realtime";
import { uploadDeliveryProof, getDeliveryProofSignedUrl } from "@/server/storage";
import { HttpError } from "@/server/handler";
import { notifyDeliveryPickedUp, notifyDeliveryDelivered } from "@/server/whatsapp/triggers";

/**
 * Riders can only ever be assigned to DELIVERY-type orders — enforced here, not just in the UI.
 *
 * delivery.assignRider only covers the first assignment. Reassigning an order that already has a
 * rider is the distinct, separately-labeled `delivery.reassignRider` permission in the registry —
 * without this check, anyone holding assignRider could silently reassign an already-dispatched
 * order to someone else too. No seeded role currently holds one without the other (Owner/Branch
 * Manager get both), so this wasn't reachable by any built-in role, but the registry models it as
 * a distinct capability and a tenant's custom role should be able to actually rely on that.
 */
export async function assignRider(
  tenantId: string,
  branchId: string,
  orderId: string,
  riderId: string,
  actorId: string,
  permissions: readonly string[]
) {
  const db = tenantDb(tenantId);
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.type !== "DELIVERY") throw new HttpError(400, "Only delivery orders can be assigned to a rider.");
  if (order.assignedRiderId && !permissions.includes("delivery.reassignRider")) {
    throw new HttpError(403, "Missing permission: delivery.reassignRider");
  }

  const deliveryOtpCode = String(Math.floor(1000 + Math.random() * 9000));
  const updated = await db.order.update({
    where: { id: orderId },
    data: { assignedRiderId: riderId, riderAssignedAt: new Date(), deliveryOtpCode },
  });
  await db.orderEvent.create({
    data: { tenantId, orderId, type: "RIDER_ASSIGNED", actorId, payload: { riderId } },
  });
  await publish(tenantId, branchId, "orders", "rider_assigned", { orderId, riderId });
  return updated;
}

/** Only the assigned rider may transition their own order — verified here (not just filtered by
 * `orders.view`-style permission), since a rider's session otherwise carries no order-scoping. */
async function assertOwnAssignment(tenantId: string, orderId: string, riderId: string) {
  const db = tenantDb(tenantId);
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.assignedRiderId !== riderId) {
    throw new HttpError(403, "This order is not assigned to you.");
  }
  return order;
}

export async function markPickedUp(tenantId: string, branchId: string, orderId: string, riderId: string) {
  await assertOwnAssignment(tenantId, orderId, riderId);
  const db = tenantDb(tenantId);
  const updated = await db.order.update({ where: { id: orderId }, data: { pickedUpAt: new Date() } });
  await db.orderEvent.create({ data: { tenantId, orderId, type: "PICKED_UP", actorId: riderId } });
  await publish(tenantId, branchId, "orders", "order_picked_up", { orderId });
  await notifyDeliveryPickedUp(tenantId, branchId, orderId);
  return updated;
}

export type DeliveryProofInput =
  | { method: "PHOTO"; file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> } }
  | { method: "OTP"; code: string };

/** Requires a proof of drop-off before the order can be marked delivered — a photo (uploaded to
 * Supabase Storage, private bucket) or the handoff code generated when the rider was assigned. */
export async function markDelivered(
  tenantId: string,
  branchId: string,
  orderId: string,
  riderId: string,
  proof: DeliveryProofInput
) {
  const order = await assertOwnAssignment(tenantId, orderId, riderId);
  const db = tenantDb(tenantId);

  let deliveryProofUrl: string | undefined;
  if (proof.method === "OTP") {
    if (!order.deliveryOtpCode || proof.code !== order.deliveryOtpCode) {
      throw new HttpError(400, "Incorrect delivery code.");
    }
  } else {
    deliveryProofUrl = await uploadDeliveryProof(tenantId, orderId, proof.file);
  }

  const updated = await db.order.update({
    where: { id: orderId },
    data: {
      deliveredAt: new Date(),
      deliveryProofMethod: proof.method,
      deliveryProofUrl,
      // A paid order stays PAID: every sales figure counts status PAID, and overwriting it here used
      // to take a prepaid delivery out of the takings the moment it arrived. An unpaid one becomes
      // DELIVERED — cash on delivery, still to be handed in, which takePayment will accept.
      ...(order.paidAt ? {} : { status: "DELIVERED" as const }),
    },
  });
  await db.orderEvent.create({
    data: { tenantId, orderId, type: "DELIVERED", actorId: riderId, payload: { method: proof.method } },
  });
  await publish(tenantId, branchId, "orders", "order_delivered", { orderId });
  await notifyDeliveryDelivered(tenantId, branchId, orderId);
  return updated;
}

/** Every order currently assigned to this rider and not yet delivered — the hard boundary that
 * keeps a rider from ever seeing another rider's orders, independent of whatever permissions their
 * session happens to carry. */
export async function listMyDeliveries(tenantId: string, riderId: string) {
  const db = tenantDb(tenantId);
  return db.order.findMany({
    where: { assignedRiderId: riderId, deliveredAt: null, status: { notIn: ["VOIDED", "CANCELLED"] } },
    orderBy: { riderAssignedAt: "asc" },
    include: { lines: true, customer: true, table: false },
  });
}

export async function listDeliveryBoard(tenantId: string, branchId: string) {
  const db = tenantDb(tenantId);
  const orders = await db.order.findMany({
    where: {
      branchId,
      type: "DELIVERY",
      status: { notIn: ["VOIDED", "CANCELLED", "OPEN"] },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { lines: true },
  });

  // Three buckets, matching the brief exactly: "Ready for Pickup" covers the order sitting there
  // whether or not a rider has been assigned yet (that's just dispatch bookkeeping from the
  // restaurant's point of view); "In Progress" starts the moment a rider actually has it in hand.
  return {
    readyForPickup: orders.filter((o) => !o.pickedUpAt && !o.deliveredAt),
    inProgress: orders.filter((o) => o.pickedUpAt && !o.deliveredAt),
    delivered: orders.filter((o) => o.deliveredAt),
    // Delivered, and the rider still has the cash. Listed on its own so the counter can take it in.
    awaitingCash: orders.filter((o) => o.deliveredAt && !o.paidAt),
  };
}

/**
 * Currently unreferenced — kept for the delivery-proof viewer this was written for. It takes the
 * tenantId and refuses a path outside that tenant's prefix on purpose: uploadDeliveryProof stores
 * under `{tenantId}/...`, and a signed URL is minted with the service-role key, which ignores RLS
 * entirely. Without this check, wiring it to anything that accepts a caller-supplied path would
 * hand out a readable URL for another tenant's delivery photos.
 */
export async function resolveProofUrl(tenantId: string, path: string | null) {
  if (!path) return null;
  if (!path.startsWith(`${tenantId}/`)) return null;
  return getDeliveryProofSignedUrl(path);
}
