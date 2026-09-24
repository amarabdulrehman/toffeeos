/**
 * How long a ticket has been waiting, in a form a cook reads at a glance.
 *
 * Minutes and seconds only, it used to be — so an order left on the board overnight read
 * "29259:41". Past an hour the seconds stop mattering and the minutes stop being readable: "1h 04m",
 * then "2d 5h" for anything that has clearly been forgotten. Under an hour it is unchanged.
 */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}:${(seconds % 60).toString().padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
