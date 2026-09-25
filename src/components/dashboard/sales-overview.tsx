"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShoppingBag, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaTrendChart } from "@/components/charts/area-trend-chart";
import { addDays } from "@/lib/business-day";
import { formatPkr } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  METHOD_LABEL,
  changePct,
  dayMonth,
  hourlySeries,
  monthOf,
  shortDay,
  type DayReport,
  type PeriodReport,
  type SalesTotals,
} from "@/lib/daily-sales";

type Choice = "today" | "yesterday" | "7d" | "30d" | "month";

const CHOICES: { key: Choice; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];

/** What the card draws, whichever kind of report it came from. */
interface Summary {
  totals: SalesTotals;
  compare: { label: string; orderCount: number; netPaisa: number };
  chart: { label: string; salesPaisa: number }[];
  chartTitle: string;
}

function fromDay(r: DayReport): Summary {
  return {
    totals: r.totals,
    compare: r.compare,
    chart: hourlySeries(r.byHour, r.dayStartMinutes),
    chartTitle: "Sales by hour",
  };
}

function fromPeriod(r: PeriodReport): Summary {
  return {
    totals: r.totals,
    compare: r.compare,
    chart: r.days.map((d) => ({ label: dayMonth(d.day), salesPaisa: d.netPaisa })),
    chartTitle: "Net sales by day",
  };
}

/** Where each choice's figures come from, and how to describe the dates it covers. */
function sourceFor(choice: Choice, today: string): { url: string; kind: "day" | "period"; dates: string } {
  const span = (from: string) => ({
    url: `/api/sales/period?from=${from}&to=${today}`,
    kind: "period" as const,
    dates: `${dayMonth(from)} – ${dayMonth(today)}, including today so far`,
  });
  switch (choice) {
    case "today":
      return { url: `/api/sales/day?date=${today}`, kind: "day", dates: `${shortDay(today)}, so far` };
    case "yesterday": {
      const day = addDays(today, -1);
      return { url: `/api/sales/day?date=${day}`, kind: "day", dates: shortDay(day) };
    }
    case "7d":
      return span(addDays(today, -6));
    case "30d":
      return span(addDays(today, -29));
    case "month":
      return span(monthOf(today).from);
  }
}

/**
 * The sales card on the dashboard: today, yesterday, the last week or month, one tap apart.
 *
 * The same figures as the Daily Sales screen — it reads the same two endpoints — so the dashboard
 * and the closing can never disagree. Today arrives with the page; the others load when first
 * picked and are kept, so flicking between them is instant after that.
 */
export function SalesOverview({ initial }: { initial: DayReport }) {
  const today = initial.day;
  const [choice, setChoice] = useState<Choice>("today");
  const [loaded, setLoaded] = useState<Record<string, Summary | { error: string }>>(() => ({
    [sourceFor("today", today).url]: fromDay(initial),
  }));

  const source = sourceFor(choice, today);
  const current = loaded[source.url];

  useEffect(() => {
    if (loaded[source.url]) return;
    let cancelled = false;
    fetch(source.url)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        const entry = res.ok
          ? source.kind === "day"
            ? fromDay(body as DayReport)
            : fromPeriod(body as PeriodReport)
          : { error: body.error ?? "Could not load these sales." };
        setLoaded((prev) => ({ ...prev, [source.url]: entry }));
      })
      .catch(() => {
        if (!cancelled) setLoaded((prev) => ({ ...prev, [source.url]: { error: "Could not reach the server." } }));
      });
    return () => {
      cancelled = true;
    };
  }, [source.url, source.kind, loaded]);

  return (
    <Card className="relative overflow-hidden shadow-lg ring-1 ring-primary/10 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-transparent">
      <CardHeader className="gap-3 bg-gradient-to-b from-primary/[0.07] to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="font-heading">Sales</CardTitle>
            <CardDescription>{source.dates}</CardDescription>
          </div>
          <div role="group" aria-label="Sales period" className="flex flex-wrap gap-1 rounded-xl bg-muted/60 p-1">
            {CHOICES.map((c) => (
              <Button
                key={c.key}
                variant={choice === c.key ? "default" : "ghost"}
                aria-pressed={choice === c.key}
                className="h-9 px-3 text-sm"
                onClick={() => setChoice(c.key)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!current && <OverviewSkeleton />}
        {current && "error" in current && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <TriangleAlert className="size-4 text-destructive/70" />
            {current.error}
          </div>
        )}
        {current && "totals" in current && <OverviewBody summary={current} isToday={choice === "today"} />}
        <div className="mt-4 flex justify-end">
          <Button render={<Link href="/app/sales" />} nativeButton={false} variant="outline" className="group/btn">
            Every detail in Daily Sales
            <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading sales">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function OverviewBody({ summary, isToday }: { summary: Summary; isToday: boolean }) {
  const t = summary.totals;
  const trend = changePct(t.netPaisa, summary.compare.netPaisa);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <div className="font-heading text-4xl font-bold tabular-nums text-primary" data-testid="sales-net">
          {formatPkr(t.netPaisa)}
        </div>
        {trend !== null && (
          <div
            className={cn(
              "mb-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold",
              trend >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            )}
          >
            {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {trend >= 0 ? "+" : ""}
            {trend.toFixed(1)}%
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        net sales · {formatPkr(summary.compare.netPaisa)} {summary.compare.label}
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Figure label="Orders" value={String(t.orderCount)} />
        <Figure label="Average order" value={formatPkr(t.averageOrderPaisa)} />
        {t.byPaymentMethod.map((p) => (
          <Figure key={p.method} label={METHOD_LABEL[p.method] ?? p.method} value={formatPkr(p.amountPaisa)} />
        ))}
        {/* Without this, the payment methods add up to more than the net figure whenever
            something was refunded, and the card looks wrong. */}
        {t.refundedPaisa > 0 && <Figure label="Refunds" value={`−${formatPkr(t.refundedPaisa)}`} />}
      </dl>

      <div className="mt-4">
        {t.orderCount === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
            <ShoppingBag className="size-5 text-muted-foreground/50" />
            {isToday ? "No sales yet today." : "No sales in this period."}
          </div>
        ) : (
          <>
            <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{summary.chartTitle}</div>
            <AreaTrendChart data={summary.chart} xKey="label" yKey="salesPaisa" height={160} />
          </>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
