import { describe, expect, it } from "vitest";
import { derivedMonthlyRatePaisa, effectiveMonthlyRatePaisa, getBillingStatus } from "@/lib/billing";

const NOW = new Date("2026-08-20T12:00:00Z");

describe("getBillingStatus", () => {
  it("reports unbilled when neither date is set", () => {
    const status = getBillingStatus({ tenantStatus: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null }, NOW);
    expect(status.state).toBe("unbilled");
    expect(status.isOverdue).toBe(false);
    expect(status.paidThrough).toBeNull();
  });

  it("currentPeriodEnd wins over a later trialEndsAt — paying ends the trial", () => {
    const status = getBillingStatus(
      {
        tenantStatus: "ACTIVE",
        trialEndsAt: new Date("2026-09-01T00:00:00Z"), // later than currentPeriodEnd
        currentPeriodEnd: new Date("2026-08-25T00:00:00Z"),
      },
      NOW
    );
    expect(status.paidThrough).toEqual(new Date("2026-08-25T00:00:00Z"));
    expect(status.isTrial).toBe(false);
  });

  it("is not overdue on the exact paid-through day (end-of-day boundary)", () => {
    // paidThrough is "today" (same calendar day as NOW) — must not be overdue until after 23:59:59.
    const status = getBillingStatus(
      { tenantStatus: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2026-08-20T00:00:00Z") },
      NOW
    );
    expect(status.isOverdue).toBe(false);
    expect(status.state).toBe("due_soon");
  });

  it("is overdue the day after paid-through, with the correct day count", () => {
    const status = getBillingStatus(
      { tenantStatus: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2026-08-07T00:00:00Z") },
      NOW
    );
    expect(status.isOverdue).toBe(true);
    expect(status.state).toBe("overdue");
    expect(status.daysRemaining).toBe(-13);
    expect(status.label).toBe("Overdue by 13 days");
  });

  it("flags due_soon within 7 days of expiry", () => {
    const status = getBillingStatus(
      { tenantStatus: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2026-08-24T00:00:00Z") },
      NOW
    );
    expect(status.state).toBe("due_soon");
    expect(status.isOverdue).toBe(false);
  });

  it("a suspended tenant still honestly reports isOverdue", () => {
    const status = getBillingStatus(
      { tenantStatus: "SUSPENDED", trialEndsAt: null, currentPeriodEnd: new Date("2026-08-01T00:00:00Z") },
      NOW
    );
    expect(status.state).toBe("inactive");
    expect(status.isOverdue).toBe(true);
  });

  it("labels a still-active trial distinctly from a paid period", () => {
    const status = getBillingStatus(
      { tenantStatus: "TRIALING", trialEndsAt: new Date("2026-09-10T00:00:00Z"), currentPeriodEnd: null },
      NOW
    );
    expect(status.state).toBe("trialing");
    expect(status.isTrial).toBe(true);
  });
});

describe("effectiveMonthlyRatePaisa", () => {
  it("uses the plan formula when no custom price is set", () => {
    expect(
      effectiveMonthlyRatePaisa({ customMonthlyPricePaisa: null, activeBranchCount: 3, pricePaisaPerBranchMonth: 500_000 })
    ).toBe(1_500_000);
  });

  it("a custom price fully overrides the formula, regardless of branch count", () => {
    expect(
      effectiveMonthlyRatePaisa({ customMonthlyPricePaisa: 750_000, activeBranchCount: 3, pricePaisaPerBranchMonth: 500_000 })
    ).toBe(750_000);
  });
});

describe("derivedMonthlyRatePaisa", () => {
  it("derives a sensible monthly rate from a 3-month period", () => {
    const rate = derivedMonthlyRatePaisa(300_000, new Date("2026-08-01"), new Date("2026-11-01"));
    // 92 days / 30 ≈ 3.07 months -> ~Rs 977/month from Rs 3000 total
    expect(rate).toBeGreaterThan(90_000);
    expect(rate).toBeLessThan(100_000);
  });

  it("never divides by zero for a same-day period", () => {
    const rate = derivedMonthlyRatePaisa(100_000, new Date("2026-08-01"), new Date("2026-08-01"));
    expect(Number.isFinite(rate)).toBe(true);
  });
});
