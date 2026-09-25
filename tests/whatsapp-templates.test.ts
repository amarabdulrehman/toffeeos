import { describe, expect, it } from "vitest";
import { summarySalesText, TEMPLATE_FIELDS } from "@/lib/whatsapp-templates";

describe("the daily summary's sales figure", () => {
  it("is net of refunds, and says so when there were any", () => {
    expect(summarySalesText(2_644_300, 242_000)).toBe("Rs 24,023 net (Rs 26,443 taken, Rs 2,420 refunded)");
  });

  it("is just the figure on a day without refunds", () => {
    expect(summarySalesText(2_644_300, 0)).toBe("Rs 26,443");
  });
});

describe("template fields", () => {
  it("never change in number — Meta rejects a message that doesn't match its approved template", () => {
    // Changing a count here breaks every template an owner already has approved. If a field really
    // must be added, every tenant's template has to be re-approved first.
    expect(Object.fromEntries(Object.entries(TEMPLATE_FIELDS).map(([k, v]) => [k, v.length]))).toEqual({
      low_stock_alert: 3,
      daily_summary: 5,
      win_back_30d: 1,
      delivery_picked_up: 2,
      delivery_delivered: 2,
      thank_you: 2,
    });
  });
});
