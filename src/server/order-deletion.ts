import "server-only";
import { tenantDb, runInTenantTransaction } from "@/server/db";
import { HttpError } from "@/server/handler";
import { publish } from "@/server/realtime";
import { closePendingApprovals } from "@/server/orders";
import { giveBackRedemption, reverseForDeletion } from "@/server/loyalty-ledger";
import { restockForDeletedOrder } from "@/server/recipes";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Deleting an order — taking it off the books entirely, paid or not, on any day.
 *
 * A client asked for it because their previous software had it: wrong orders, test orders,
 * duplicates. It is also exactly what a tax authority calls sales suppression, so it is built to
 * leave a trail that tells a correction apart from that:
 *
 *   - It must be switched on for the restaurant by a platform admin (the grant-only "orderDelete"
 *     feature; the route gates on it).
 *   - Only the restaurant owner can do it — checked against the database here, not taken from the
 *     login token — and only by typing their password again, so a till left signed in as the owner
 *     isn't enough. Password attempts are rate-limited.
 *   - Not while a platform admin is impersonating the owner: the log would name the owner for
 *     something they didn't do.
 *   - A reason is required, and an OrderDeletion row records what the order was, who removed it,
 *     when and why. The app's database role can only insert and read that table.
 *
 * The order row is kept, at status DELETED. Every sale, report and drawer figure counts PAID orders,
 * so it drops out of all of them on its own; the order lists that work by excluding closed statuses
 * list DELETED among them. Its refunds leave the drawer too, so money in and money out go together.
 */

const MAX_REASON = 280;

export interface DeleteOrderActor {
  userId: string;
  impersonatedByPlatformUserId?: string;
}

export interface DeleteOrderInput {
  reason: string;
  password: string;
  /** "The food was never made" — only meaningful for a paid order, since stock is used at payment. */
  restock: boolean;
}

export async function deleteOrder(tenantId: string, actor: DeleteOrderActor, orderId: string, input: DeleteOrderInput) {
  if (actor.impersonatedByPlatformUserId) {
    throw new HttpError(403, "Orders can't be deleted while you're signed in as the owner from the admin panel.");
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw new HttpError(400, "Say why this order is being deleted.");
  if (reason.length > MAX_REASON) throw new HttpError(400, `Keep the reason under ${MAX_REASON} characters.`);

  const db = tenantDb(tenantId);

  // The owner, by the database's account. A login token can be hours old; a role can have changed.
  const ownership = await db.membership.findFirst({
    where: { userId: actor.userId, isActive: true, role: { key: "owner" } },
    select: { id: true },
  });
  if (!ownership) throw new HttpError(403, "Only the restaurant owner can delete orders.");

  // Checked before the password, so the limit applies to guesses and can't be skipped by a wrong one.
  if (!(await checkRateLimit(`order-delete-auth:${actor.userId}`, 5, 15 * 60 * 1000))) {
    throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  }
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { name: true, passwordHash: true } });
  if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new HttpError(401, "That password isn't right.");
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { lines: true, payments: true },
  });
  if (!order) throw new HttpError(404, "That order doesn't exist.");
  if (order.status === "DELETED") throw new HttpError(409, "This order has already been deleted.");

  const wasPaid = order.paidAt != null;
  const liveLines = order.lines.filter((l) => !l.isVoided);
  const wasOpen = ["OPEN", "SENT_TO_KITCHEN", "READY", "SERVED"].includes(order.status);

  const deletion = await runInTenantTransaction(tenantId, async (tx) => {
    // Re-read inside the transaction: two devices deleting at once must not both go through.
    const fresh = await tx.order.findFirst({ where: { id: orderId, tenantId }, select: { status: true } });
    if (!fresh || fresh.status === "DELETED") throw new HttpError(409, "This order has already been deleted.");

    await tx.order.updateMany({
      where: { id: orderId, tenantId },
      data: { status: "DELETED", version: { increment: 1 } },
    });
    await tx.orderEvent.create({
      data: { tenantId, orderId, type: "DELETED", actorId: actor.userId, payload: { reason, restock: input.restock } },
    });
    await closePendingApprovals(tx, orderId, actor.userId, "The order was deleted.");
    // Points the customer spent on it go back to them; points it earned come off.
    await giveBackRedemption(tx, tenantId, orderId, actor.userId);
    await reverseForDeletion(tx, tenantId, { id: orderId, customerId: order.customerId }, actor.userId);

    if (order.tableId && wasOpen) {
      await tx.restaurantTable.updateMany({ where: { id: order.tableId, tenantId }, data: { status: "AVAILABLE" } });
    }

    const restocked = input.restock && wasPaid;
    if (restocked) {
      await restockForDeletedOrder(
        tx,
        tenantId,
        order.branchId,
        liveLines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
        actor.userId,
        order.orderNumber
      );
    }

    return tx.orderDeletion.create({
      data: {
        tenantId,
        branchId: order.branchId,
        orderId,
        orderNumber: order.orderNumber,
        orderType: order.type,
        previousStatus: order.status,
        totalPaisa: order.totalPaisa,
        paidPaisa: order.paidPaisa,
        refundedPaisa: order.refundedPaisa,
        payments: order.payments.map((p) => ({ method: p.method, amountPaisa: p.amountPaisa })),
        lines: liveLines.map((l) => ({ name: l.nameSnapshot, quantity: l.quantity, lineTotalPaisa: l.lineTotalPaisa })),
        orderCreatedAt: order.createdAt,
        orderPaidAt: order.paidAt,
        reason,
        restocked,
        deletedById: actor.userId,
        deletedByName: user.name,
      },
    });
  });

  // Every screen showing this order — the queue, the kitchen, the floor plan — drops it.
  await publish(tenantId, order.branchId, "orders", "order_deleted", { orderId });
  await publish(tenantId, order.branchId, "kds", "order_deleted", { orderId });
  if (order.tableId && wasOpen) {
    await publish(tenantId, order.branchId, "tables", "table_status_changed", { tableId: order.tableId, status: "AVAILABLE" });
  }
  return deletion;
}

/** The deletion log, newest first. Owner-facing; the platform panel reads the same rows. */
export async function listOrderDeletions(tenantId: string, limit = 200) {
  const rows = await tenantDb(tenantId).orderDeletion.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
  const branches = await tenantDb(tenantId).branch.findMany({ select: { id: true, name: true } });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return rows.map((r) => ({ ...r, branchName: branchName.get(r.branchId) ?? "" }));
}
