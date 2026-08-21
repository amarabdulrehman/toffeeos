"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPkr } from "@/lib/money";

/** Single-series magnitude-over-time chart — gradient-filled area, one primary hue, no legend
 * needed (one series). Dependency-free custom tooltip (doesn't pull in shadcn's chart.tsx/Radix
 * Tooltip wrapper — this app's own Tooltip primitive is Base UI, and recharts' own hover/active
 * state doesn't need it, just a plain positioned div).
 *
 * Formats every value as PKR directly rather than taking a `valueFormatter` prop — every current
 * caller charts money, and a callback prop can't cross the Server→Client boundary (some callers,
 * like the dashboard, render this from a Server Component: passing a function crashes with
 * "Functions cannot be passed directly to Client Components"). Revisit if a non-money chart shows
 * up later. */
function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg ring-1 ring-foreground/10">
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-heading text-sm font-semibold tabular-nums text-foreground">
        {formatPkr(payload[0].value)}
      </div>
    </div>
  );
}

export function AreaTrendChart({
  data,
  xKey,
  yKey,
  height = 200,
  color = "var(--color-primary)",
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  height?: number;
  color?: string;
}) {
  if (data.length === 0) {
    return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No data in this range.</div>;
  }
  const gradientId = `trend-fill-${yKey}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey={xKey}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
          minTickGap={24}
        />
        <YAxis hide domain={["dataMin", "dataMax + 1"]} />
        <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: "var(--color-background)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
