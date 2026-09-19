import "server-only";
import { tenantDb, runInTenantTransaction } from "@/server/db";
import { HttpError } from "@/server/handler";
import { assertInt } from "@/lib/money";
import type { PaymentMethodKey } from "@/lib/pricing";

/**
 * Giving money back.
 *
 * Until now there was no way to reverse a paid order at all: `pos.payment.refund` existed as a
 * permission string and nowhere else, and `PAID` is a terminal status so voiding was refused by
 * design. A wrongly rung-up bill, a returned dish or a double charge had to be settled in cash
 * off-system and reconciled by hand, which meant the day's reports and the till disagreed and
 * nobody could say why.
 *
 * Three decisions worth knowing, because each could reasonably have gone the other way:
 *
 * **Refunds are their own rows, not negative payments.** A negative Payment would have netted out
 * automatically in every existing sum, which is exactly the problem — the cash drawer, the
 * transactions report and paymentStanding all assume a positive amount, and a negative row would
 * silently change what each of them means. Separate rows force every caller that cares to subtract
 * refunds deliberately.
 *
 * **The order keeps its status.** A fully refunded order stays PAID with refundedPaisa equal to
 * paidPaisa, rather than moving to a REFUNDED state. Partial refunds are the common case and have
 * no sensible status of their own, so one mechanism covers both, and "sold Rs 1,000, returned
 * Rs 100" stays a different fact from "sold Rs 900".
 *
 * **Stock is not returned.** Recipe consumption is deducted at payment, and refunding a dish that
 * was cooked does not put the ingredients back in the store. An owner who genuinely restocked
 * something records that as a stock adjustment, which is a different event with a different reason.
 */

export interface RefundInput {
  amountPaisa: number;
  method: PaymentMethodKey;
  reason: string;
}

export interface RefundView {
  id: string;
  amountPaisa: number;
  method: string;
  reason: string;
  refundedByName: string | null;
  createdAt: string;
}

const MAX_REASON = 280;

export async function listRefunds(tenantId: string, orderId: string): Promise<RefundView[]> {
  const rows = await tenantDb(tenantId).refund.findMany({
    where: { orderId },
    include: { refundedBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    amountPaisa: r.amountPaisa,
    method: r.method,
    reason: r.reason,
    refundedByName: r.refundedBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Records a refund against a paid order.
 *
 * The whole thing runs in one transaction that re-reads the order, because the amount already
 * refunded is what bounds this one: two managers refunding the same Rs 500 order at the same moment
 * must not both succeed. Reading the order outside the transaction and trusting it would let
 * exactly that through.
 */
export async function refundOrder(
  tenantId: string,
  branchId: string,
  orderId: string,
  actorId: string | null,
  input: RefundInput
) {
  assertInt(input.amountPaisa, "amountPaisa");
  if (input.amountPaisa <= 0) throw new HttpError(400, "A refund has to be for more than zero.");

  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Give a reason for the refund.");
  if (reason.length > MAX_REASON) throw new HttpError(400, `Keep the reason under ${MAX_REASON} characters.`);

  return runInTenantTransaction(tenantId, async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, branchId } });
    if (!order) throw new HttpError(404, "That order doesn't exist at this branch.");

    // You cannot give back money that was never taken. An unpaid order is corrected by voiding it,
    // which is a different action with different bookkeeping.
    if (order.paidPaisa <= 0) {
      throw new HttpError(400, "Nothing has been paid on this order, so there is nothing to refund.");
    }

    const remaining = order.paidPaisa - order.refundedPaisa;
    if (remaining <= 0) throw new HttpError(400, "This order has already been fully refunded.");
    if (input.amountPaisa > remaining) {
      throw new HttpError(
        400,
        `That is more than is left to refund on this order — at most ${remaining / 100} can be returned.`
      );
    }

    const refund = await tx.refund.create({
      data: {
        tenantId,
        orderId,
        amountPaisa: input.amountPaisa,
        method: input.method,
        reason,
        refundedById: actorId,
      },
    });

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { refundedPaisa: { increment: input.amountPaisa }, version: { increment: 1 } },
    });

    // On the order's own timeline as well as in the Refund table, so the history a manager reads
    // on the order shows the refund in sequence with everything else that happened to it.
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId,
        type: "REFUNDED",
        actorId,
        payload: { amountPaisa: input.amountPaisa, method: input.method, reason },
      },
    });

    return { refund, order: updated };
  });
}
