import { formatPkr } from "@/lib/money";

/**
 * What each numbered field in a WhatsApp template is filled with, in order.
 *
 * Owners write their own template text and Meta approves it with a fixed number of fields. A
 * message sent with a different number is rejected, so the fields here are a contract: adding one
 * breaks every template already approved. Change what a field says, never how many there are.
 * The template editor shows this list so an owner knows what {{4}} will become.
 */
export const TEMPLATE_FIELDS: Record<string, string[]> = {
  low_stock_alert: ["Item name", "Quantity left", "Alert threshold"],
  daily_summary: ["Date", "Branch name", "Number of orders", "Net sales (refunds noted when there are any)", "Top three items"],
  win_back_30d: ["Customer name"],
  delivery_picked_up: ["Customer name", "Order number"],
  delivery_delivered: ["Customer name", "Order number"],
  thank_you: ["Customer name", "Restaurant name"],
};

/**
 * The day's takings for the daily summary: net of refunds, which is the figure Daily Sales leads
 * with. When something was refunded, the same field says so — a separate field would change the
 * template's field count, and Meta would reject the message.
 */
export function summarySalesText(grossPaisa: number, refundedPaisa: number): string {
  const net = formatPkr(grossPaisa - refundedPaisa);
  if (refundedPaisa <= 0) return net;
  return `${net} net (${formatPkr(grossPaisa)} taken, ${formatPkr(refundedPaisa)} refunded)`;
}
