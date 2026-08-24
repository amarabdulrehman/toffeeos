import "server-only";
import { platformDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import { assertInt } from "@/lib/money";
import { derivedMonthlyRatePaisa } from "@/lib/billing";

/**
 * Platform-admin manual billing: recording payments, reading payment history, and setting a
 * per-tenant custom recurring rate. Kept as its own module rather than folded into
 * src/server/platform.ts — billing is a cohesive subdomain with its own model and its own
 * transactional semantics, same convention as orders.ts/branches.ts/inventory.ts being split out
 * from the rest of the tenant-side server code.
 *
 * Every write here goes through platformDb (BYPASSRLS) directly, never tenantDb()/
 * runInTenantTransaction — the platform admin panel has no tenant session to scope by, and
 * SubscriptionPayment's own RLS policy would just get bypassed by the platform_user role anyway
 * (same reasoning as every other platform.ts function).
 */

export interface RecordPaymentInput {
  tenantId: string;
  amountPaisa: number;
  periodStart: Date;
  periodEnd: Date;
  method: string;
  note?: string;
  /** Also write Subscription.customMonthlyPricePaisa from this payment. */
  setAsRecurringRate?: boolean;
  /** Explicit rate; when omitted and setAsRecurringRate is true, derived from amount ÷ period. */
  recurringRatePaisa?: number;
}

export interface RecordPaymentResult {
  paymentId: string;
  currentPeriodEnd: Date;
  /** True when Tenant.status was flipped to ACTIVE by this payment — paying always un-suspends. */
  reactivated: boolean;
  previousTenantStatus: string;
}

const MAX_PERIOD_YEARS_OUT = 10;

export async function recordTenantPayment(
  input: RecordPaymentInput,
  platformUserId: string,
  platformUserEmail: string
): Promise<RecordPaymentResult> {
  assertInt(input.amountPaisa, "amountPaisa");
  if (input.amountPaisa < 0) throw new HttpError(400, "Amount cannot be negative.");
  if (input.periodEnd <= input.periodStart) {
    throw new HttpError(400, "Period end must be after period start.");
  }
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + MAX_PERIOD_YEARS_OUT);
  if (input.periodEnd > maxDate) {
    throw new HttpError(400, `Period end can't be more than ${MAX_PERIOD_YEARS_OUT} years out — check the date.`);
  }
  if (input.recurringRatePaisa != null) {
    assertInt(input.recurringRatePaisa, "recurringRatePaisa");
    if (input.recurringRatePaisa < 0) throw new HttpError(400, "Recurring rate cannot be negative.");
  }

  return platformDb.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { tenantId: input.tenantId },
      include: { plan: true, tenant: { select: { status: true } } },
    });
    if (!subscription) throw new HttpError(404, "This tenant has no subscription to bill.");

    const payment = await tx.subscriptionPayment.create({
      data: {
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        planKey: subscription.plan.key,
        amountPaisa: input.amountPaisa,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        method: input.method,
        note: input.note,
        recordedById: platformUserId,
        recordedByEmail: platformUserEmail,
      },
    });

    // Advance-only: a payment back-recorded for a period that's already covered by a later
    // existing currentPeriodEnd must never regress it.
    const previousPeriodEnd = subscription.currentPeriodEnd;
    const nextPeriodEnd =
      previousPeriodEnd && previousPeriodEnd > input.periodEnd ? previousPeriodEnd : input.periodEnd;

    const recurringRatePaisa = input.setAsRecurringRate
      ? (input.recurringRatePaisa ?? derivedMonthlyRatePaisa(input.amountPaisa, input.periodStart, input.periodEnd))
      : undefined;

    await tx.subscription.update({
      where: { tenantId: input.tenantId },
      data: {
        currentPeriodEnd: nextPeriodEnd,
        paymentMethod: input.method,
        // First place this enum becomes meaningful — still doesn't gate anything on its own.
        status: "ACTIVE",
        ...(input.setAsRecurringRate ? { customMonthlyPricePaisa: recurringRatePaisa } : {}),
      },
    });

    const previousTenantStatus = subscription.tenant.status;
    const reactivated = previousTenantStatus !== "ACTIVE";
    if (reactivated) {
      await tx.tenant.update({ where: { id: input.tenantId }, data: { status: "ACTIVE" } });
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: platformUserId,
        action: "platform.billing.payment",
        entityType: "SubscriptionPayment",
        entityId: payment.id,
        metadata: {
          platformUserEmail,
          amountPaisa: input.amountPaisa,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          method: input.method,
          previousPeriodEnd,
          previousTenantStatus,
          reactivated,
          recurringRateSet: input.setAsRecurringRate ?? false,
        },
      },
    });

    return { paymentId: payment.id, currentPeriodEnd: nextPeriodEnd, reactivated, previousTenantStatus };
  });
}

export interface SubscriptionPaymentRow {
  id: string;
  amountPaisa: number;
  periodStart: Date;
  periodEnd: Date;
  method: string;
  note: string | null;
  planKey: string;
  recordedByEmail: string;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

/** Ordered by periodEnd, not createdAt — a manual biller reasons in coverage periods, and a
 * back-recorded payment would otherwise sort confusingly. */
export async function listTenantPayments(tenantId: string, opts?: { take?: number }): Promise<SubscriptionPaymentRow[]> {
  return platformDb.subscriptionPayment.findMany({
    where: { tenantId },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    take: opts?.take ?? 50,
  });
}

/** Sets (or clears, with null) a tenant's contracted monthly rate independent of recording a
 * payment — for a mid-period renegotiation that shouldn't wait for the next renewal. */
export async function setCustomMonthlyRate(
  tenantId: string,
  customMonthlyPricePaisa: number | null,
  platformUserId: string,
  platformUserEmail: string
): Promise<{ customMonthlyPricePaisa: number | null }> {
  if (customMonthlyPricePaisa != null) {
    assertInt(customMonthlyPricePaisa, "customMonthlyPricePaisa");
    if (customMonthlyPricePaisa < 0) throw new HttpError(400, "Rate cannot be negative.");
  }

  const subscription = await platformDb.subscription.findUnique({ where: { tenantId } });
  if (!subscription) throw new HttpError(404, "This tenant has no subscription to change.");

  const from = subscription.customMonthlyPricePaisa;
  const updated = await platformDb.subscription.update({
    where: { tenantId },
    data: { customMonthlyPricePaisa },
  });

  await platformDb.auditLog.create({
    data: {
      tenantId,
      actorId: platformUserId,
      action: "platform.billing.rate.change",
      entityType: "Subscription",
      entityId: subscription.id,
      metadata: { platformUserEmail, from, to: customMonthlyPricePaisa },
    },
  });

  return { customMonthlyPricePaisa: updated.customMonthlyPricePaisa };
}

/** Soft-voids a payment and recomputes currentPeriodEnd from what's left — without the recompute,
 * voiding the payment that extended the period would leave the tenant paid-through a period
 * nobody actually paid for. */
export async function voidTenantPayment(
  tenantId: string,
  paymentId: string,
  reason: string,
  platformUserId: string,
  platformUserEmail: string
): Promise<{ currentPeriodEnd: Date | null }> {
  if (!reason.trim()) throw new HttpError(400, "A reason is required to void a payment.");

  return platformDb.$transaction(async (tx) => {
    const payment = await tx.subscriptionPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.tenantId !== tenantId) throw new HttpError(404, "Payment not found.");
    if (payment.voidedAt) throw new HttpError(409, "This payment is already voided.");

    await tx.subscriptionPayment.update({
      where: { id: paymentId },
      data: { voidedAt: new Date(), voidedById: platformUserId, voidReason: reason },
    });

    const remaining = await tx.subscriptionPayment.findMany({
      where: { tenantId, voidedAt: null, NOT: { id: paymentId } },
      select: { periodEnd: true },
    });
    const newPeriodEnd =
      remaining.length > 0 ? remaining.reduce((max, p) => (p.periodEnd > max ? p.periodEnd : max), remaining[0].periodEnd) : null;

    await tx.subscription.update({ where: { tenantId }, data: { currentPeriodEnd: newPeriodEnd } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: platformUserId,
        action: "platform.billing.void",
        entityType: "SubscriptionPayment",
        entityId: paymentId,
        metadata: { platformUserEmail, reason, amountPaisa: payment.amountPaisa, newPeriodEnd },
      },
    });

    return { currentPeriodEnd: newPeriodEnd };
  });
}
