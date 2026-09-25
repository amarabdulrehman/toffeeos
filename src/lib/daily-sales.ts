import { addDays } from "@/lib/business-day";

/**
 * The shapes the Daily Sales screen reads, and the date arithmetic behind its Week and Month views.
 * Kept free of server imports so the screen and the unit tests can both use it; the numbers
 * themselves are worked out in src/server/daily-sales.ts.
 */

export interface SalesTotals {
  orderCount: number;
  /** Everything rung up and paid for. */
  grossPaisa: number;
  /** Money handed back on these orders. */
  refundedPaisa: number;
  /** What the café kept: gross less refunds. The headline figure. */
  netPaisa: number;
  averageOrderPaisa: number;
  taxPaisa: number;
  serviceChargePaisa: number;
  /** Every discount given, per item and on whole orders. */
  discountPaisa: number;
  byPaymentMethod: { method: string; amountPaisa: number }[];
  byOrderType: { type: string; orderCount: number; grossPaisa: number }[];
}

export interface DayReport {
  day: string;
  isToday: boolean;
  /** When the business day starts, so the screen can say so when it isn't midnight. */
  dayStartMinutes: number;
  totals: SalesTotals;
  /** Sales by hour of the day, in the order the café trades them (a 4am day starts at 4am). */
  byHour: { hour: number; orderCount: number; grossPaisa: number }[];
  topItems: { name: string; quantity: number; revenuePaisa: number }[];
  byStaff: { name: string; orderCount: number; netPaisa: number }[];
  voids: { count: number; valuePaisa: number };
  /** Orders started this day and not yet paid — a table still sitting, or one never settled. */
  openOrders: { count: number; valuePaisa: number };
  compare: { label: string; orderCount: number; netPaisa: number };
}

export interface PeriodDay {
  day: string;
  orderCount: number;
  grossPaisa: number;
  refundedPaisa: number;
  netPaisa: number;
  taxPaisa: number;
  cashPaisa: number;
  cardPaisa: number;
  /** JazzCash, Easypaisa, bank transfer and anything else. */
  otherPaisa: number;
}

export interface PeriodReport {
  from: string;
  to: string;
  dayStartMinutes: number;
  totals: SalesTotals;
  /** Every day in the period, including the ones with no sales — a closing lists them all. */
  days: PeriodDay[];
  /** The same number of days just before, up to the same time if this period isn't over. */
  compare: { label: string; orderCount: number; netPaisa: number };
}

export const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

export const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  SERVICE: "Service",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(day: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export interface DayRange {
  from: string;
  to: string;
}

/** The Monday-to-Sunday week a day falls in. */
export function weekOf(day: string): DayRange {
  const { weekday } = parts(day);
  const from = addDays(day, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** The calendar month a day falls in. */
export function monthOf(day: string): DayRange {
  const { y, m } = parts(day);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

/** Moves a week or month range back (-1) or forward (+1) by one whole period. */
export function shiftPeriod(kind: "week" | "month", range: DayRange, step: -1 | 1): DayRange {
  if (kind === "week") return weekOf(addDays(range.from, 7 * step));
  const { y, m } = parts(range.from);
  const first = new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 10);
  return monthOf(first);
}

/** A period that hasn't finished yet stops at today — tomorrow's empty row is not a closing. */
export function capAtToday(range: DayRange, today: string): DayRange {
  return { from: range.from, to: range.to > today ? today : range.to };
}

/** "Mon 22 Sep" — or "Mon 22 Sep 2026" when the year matters. */
export function shortDay(day: string, withYear = false): string {
  const { y, m, d, weekday } = parts(day);
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "14 Feb" — for chart labels, where the weekday is clutter. */
export function dayMonth(day: string): string {
  const { m, d } = parts(day);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Today", "Yesterday", or the date. */
export function dayTitle(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return shortDay(day, true);
}

/** "22 – 28 Sep 2026", "29 Sep – 5 Oct 2026", or "September 2026" for a whole month. */
export function periodTitle(kind: "week" | "month", range: DayRange): string {
  const a = parts(range.from);
  if (kind === "month") return `${MONTHS_LONG[a.m - 1]} ${a.y}`;
  const b = parts(range.to);
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** 0 → "12am", 13 → "1pm". */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

/** When a business day ends, in words: "midnight", or "4am" for a café that trades late. */
export function dayEndsLabel(dayStartMinutes: number): string {
  if (dayStartMinutes <= 0) return "midnight";
  const h = Math.floor(dayStartMinutes / 60);
  const m = dayStartMinutes % 60;
  return m === 0 ? hourLabel(h) : `${h}:${String(m).padStart(2, "0")}am`;
}

/** Percentage change, or null when there is nothing to compare against. */
export function changePct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

/**
 * A day's sales hour by hour for a chart, from the first hour anything sold to the last, with the
 * quiet hours in between filled in at zero — a chart that skips from 1pm to 7pm draws a smooth line
 * through an afternoon when nothing happened. Hours run in the café's order, so a day that ends at
 * 4am runs 4am … 11pm, 12am … 3am.
 */
export function hourlySeries(
  byHour: { hour: number; grossPaisa: number }[],
  dayStartMinutes: number
): { label: string; salesPaisa: number }[] {
  if (byHour.length === 0) return [];
  const start = Math.floor(dayStartMinutes / 60);
  const position = (hour: number) => (hour - start + 24) % 24;
  const sales = new Map(byHour.map((h) => [h.hour, h.grossPaisa]));
  const positions = byHour.map((h) => position(h.hour));
  const series: { label: string; salesPaisa: number }[] = [];
  for (let p = Math.min(...positions); p <= Math.max(...positions); p++) {
    const hour = (p + start) % 24;
    series.push({ label: hourLabel(hour), salesPaisa: sales.get(hour) ?? 0 });
  }
  return series;
}
