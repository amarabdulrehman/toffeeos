"use client";

import { formatPkr } from "@/lib/money";

/** Ranked magnitude list — one hue (primary), length-encoded, direct-labeled. Deliberately not a
 * recharts BarChart: at this size (a handful of ranked rows) plain flex divs give pixel-exact
 * control over the label/value layout with zero extra chart chrome, and the "form" here is closer
 * to a labeled progress-bar list than an axis-bearing chart.
 *
 * Formats every value as PKR directly rather than taking a `valueFormatter` prop — see
 * area-trend-chart.tsx's note; a function prop can't cross a Server→Client boundary, and every
 * current caller charts money anyway. */
export function RankedBarChart({ rows }: { rows: { label: string; value: number }[] }) {
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No data in this range.</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{r.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatPkr(r.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
