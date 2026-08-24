// Pure billing-status helpers, deliberately with no "server-only" import (unlike src/server/billing.ts,
// which re-exports all of this plus the DB-touching lookups) — this file gets imported into client
// components too (the platform admin's tenant list/detail pages, both "use client"), same split as
// src/lib/tiers.ts <-> src/server/tier.ts.

import { differenceInCalendarDays, endOfDay, format } from "date-fns";
import { roundHalfUp } from "@/lib/money";

export type BillingState = "trialing" | "active" | "due_soon" | "overdue" | "unbilled" | "inactive";

export interface BillingStatusInput {
  tenantStatus: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
}

export interface BillingStatus {
  state: BillingState;
  /** The single unified date the UI shows as "paid through" — currentPeriodEnd if set, else
   * trialEndsAt, else null. */
  paidThrough: Date | null;
  /** Whole calendar days remaining; negative once overdue. Null when paidThrough is null. */
  daysRemaining: number | null;
  /** Purely date-derived — deliberately independent of tenantStatus, so a suspended tenant still
   * reports honestly whether their period also lapsed. NEVER read this (or `state`) from any
   * access-control path (tenantAcceptsLogin / getTenantGate / defineHandler) — per the product
   * decision, expiry flags in the admin panel, it never blocks access on its own. Only an explicit
   * manual suspend (Tenant.status) does that. */
  isOverdue: boolean;
  /** Whether paidThrough came from the trial rather than a recorded payment — for copy only. */
  isTrial: boolean;
  label: string;
  badgeVariant: "success" | "info" | "warning" | "destructive" | "outline";
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return typeof value === "string" ? new Date(value) : value;
}

/** Resolves a tenant's unified billing status from its trial/period dates. `now` is injectable for
 * tests; defaults to the real current time. */
export function getBillingStatus(input: BillingStatusInput, now: Date = new Date()): BillingStatus {
  const currentPeriodEnd = toDate(input.currentPeriodEnd);
  const trialEndsAt = toDate(input.trialEndsAt);
  // currentPeriodEnd always wins when set — a tenant who paid mid-trial is no longer trialing.
  const paidThrough = currentPeriodEnd ?? trialEndsAt;
  const isTrial = currentPeriodEnd == null && trialEndsAt != null;

  if (!paidThrough) {
    return {
      state: "unbilled",
      paidThrough: null,
      daysRemaining: null,
      isOverdue: false,
      isTrial: false,
      label: "No period recorded",
      badgeVariant: "outline",
    };
  }

  // Compare against end-of-day, not the raw timestamp — a plain <input type="date"> submits
  // midnight, so without this a tenant "paid through 30 Sept" would flip overdue at 00:00 on the
  // 30th, a full day early.
  const boundary = endOfDay(paidThrough);
  const isOverdue = now.getTime() > boundary.getTime();
  const daysRemaining = differenceInCalendarDays(paidThrough, now);

  const dateLabel = format(paidThrough, "d MMM yyyy");
  let state: BillingState;
  let label: string;
  let badgeVariant: BillingStatus["badgeVariant"];

  if (isOverdue) {
    state = "overdue";
    const daysOverdue = Math.abs(daysRemaining);
    label = daysOverdue === 0 ? "Overdue" : `Overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`;
    badgeVariant = "destructive";
  } else if (daysRemaining <= 7) {
    state = "due_soon";
    label = isTrial
      ? `Trial ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`
      : `Renews in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
    badgeVariant = "warning";
  } else if (isTrial) {
    state = "trialing";
    label = `Trial ends ${dateLabel}`;
    badgeVariant = "info";
  } else {
    state = "active";
    label = `Paid through ${dateLabel}`;
    badgeVariant = "success";
  }

  // tenantStatus overrides the label/state for display, but isOverdue is left untouched — a
  // suspended tenant can still honestly report that their period also lapsed.
  if (input.tenantStatus === "SUSPENDED" || input.tenantStatus === "CANCELLED") {
    state = "inactive";
  }

  return { state, paidThrough, daysRemaining, isOverdue, isTrial, label, badgeVariant };
}

/** Derives an implied monthly rate from a single payment — used only to prefill the "set as
 * recurring rate" field when recording a payment, never as a stored source of truth. Approximates
 * a month as 30 days; fine for a prefill, not for anything that needs to be exact. */
export function derivedMonthlyRatePaisa(amountPaisa: number, periodStart: Date, periodEnd: Date): number {
  const days = Math.max(1, differenceInCalendarDays(periodEnd, periodStart));
  const months = Math.max(days / 30, 1 / 30);
  return roundHalfUp(amountPaisa / months);
}

/** The single MRR rule, shared by platformMetrics() and the tenant detail page's display — a
 * tenant's customMonthlyPricePaisa override always wins when set, otherwise the plan formula. */
export function effectiveMonthlyRatePaisa(args: {
  customMonthlyPricePaisa: number | null;
  activeBranchCount: number;
  pricePaisaPerBranchMonth: number;
}): number {
  if (args.customMonthlyPricePaisa != null) return args.customMonthlyPricePaisa;
  return args.activeBranchCount * args.pricePaisaPerBranchMonth;
}

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "Easypaisa" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["value"];
