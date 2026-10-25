"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Printer,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays } from "@/lib/business-day";
import { downloadCsv } from "@/lib/csv";
import { formatPkr, paisaToRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  METHOD_LABEL,
  ORDER_TYPE_LABEL,
  capAtToday,
  changePct,
  dayEndsLabel,
  dayTitle,
  hourLabel,
  monthOf,
  periodTitle,
  shiftPeriod,
  shortDay,
  weekOf,
  type DayRange,
  type DayReport,
  type PeriodReport,
  type SalesTotals,
} from "@/lib/daily-sales";
import { ClosingDialog } from "./closing-slip";

type View =
  | { kind: "day"; day: string; /** The week or month this day was opened from, to go back to. */ from?: PeriodView }
  | PeriodView;
type PeriodView = { kind: "week" | "month"; range: DayRange };

/**
 * Loads a report and keeps the answer next to the URL it came from, so a slow answer for the
 * previous day can never be shown under the next day's heading.
 */
function useReport<T>(url: string, reloadKey: number) {
  const [result, setResult] = useState<{ url: string; key: number; data?: T; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setResult(
          res.ok
            ? { url, key: reloadKey, data: body as T }
            : { url, key: reloadKey, error: body.error ?? "Could not load these sales." }
        );
      })
      .catch(() => {
        if (!cancelled) setResult({ url, key: reloadKey, error: "Could not reach the server. Check the connection." });
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey]);

  const current = result && result.url === url ? result : null;
  // A refresh keeps the figures on screen while it loads, instead of blanking them.
  return { data: current?.data, error: current?.error, refreshing: !!current && current.key !== reloadKey };
}

/** One choice in the branch picker: all branches together, or one branch on its own clock. */
export interface SalesScope {
  /** Null asks the server for everything this person may see. */
  branchId: string | null;
  /** Whose sales these are: a branch name, or "All 2 branches". */
  label: string;
  /** Today's business day, by this scope's clock. */
  today: string;
  dayStartMinutes: number;
}

export function DailySalesView({
  scopes,
  tenantName,
  canExport = false,
}: {
  scopes: SalesScope[];
  tenantName: string;
  /** reports.export — may download the figures, not only read them. */
  canExport?: boolean;
}) {
  const [scopeIndex, setScopeIndex] = useState(0);
  const scope = scopes[scopeIndex] ?? scopes[0];
  const { today, dayStartMinutes, label: scopeLabel } = scope;
  const branchQuery = scope.branchId ? `&branchId=${scope.branchId}` : "";
  const [view, setView] = useState<View>({ kind: "day", day: today });
  const yesterday = addDays(today, -1);
  // Week and Month open on the one around whatever is on screen: pick last Tuesday, press Week, and
  // it is last Tuesday's week — not this one.
  const anchor = view.kind === "day" ? view.day : view.range.from;

  const quick: { label: string; active: boolean; go: () => void }[] = [
    { label: "Today", active: view.kind === "day" && view.day === today, go: () => setView({ kind: "day", day: today }) },
    {
      label: "Yesterday",
      active: view.kind === "day" && view.day === yesterday,
      go: () => setView({ kind: "day", day: yesterday }),
    },
    { label: "Week", active: view.kind === "week", go: () => setView({ kind: "week", range: weekOf(anchor) }) },
    { label: "Month", active: view.kind === "month", go: () => setView({ kind: "month", range: monthOf(anchor) }) },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[1.75rem] font-bold tracking-tight">Daily Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scopeLabel} · each day ends at {dayEndsLabel(dayStartMinutes)}
          </p>
        </div>
        {/* Only for someone who can see more than one branch. Each branch keeps its own clock, so
            "today" follows whichever is picked. */}
        {scopes.length > 1 && (
          <Select value={String(scopeIndex)} onValueChange={(v) => v != null && setScopeIndex(Number(v))}>
            <SelectTrigger className="h-10 w-full sm:w-64" aria-label="Branch">
              <SelectValue>{(v: string) => scopes[Number(v)]?.label ?? ""}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {scopes.map((s, i) => (
                <SelectItem key={s.branchId ?? "all"} value={String(i)}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Choose what to look at" className="flex flex-wrap gap-1 rounded-xl bg-muted/60 p-1">
          {quick.map((q) => (
            <Button
              key={q.label}
              variant={q.active ? "default" : "ghost"}
              aria-pressed={q.active}
              className="h-10 px-4 text-sm"
              onClick={q.go}
            >
              {q.label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          <span className="sr-only sm:not-sr-only">Any day</span>
          <Input
            type="date"
            aria-label="Pick a day"
            className="h-10 w-auto"
            max={today}
            value={view.kind === "day" ? view.day : ""}
            onChange={(e) => {
              const day = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today) setView({ kind: "day", day });
            }}
          />
        </label>
      </div>

      <div className="mt-6">
        {view.kind === "day" ? (
          <DayPanel
            key={`${scopeIndex}:${view.day}`}
            day={view.day}
            branchQuery={branchQuery}
            today={today}
            tenantName={tenantName}
            scopeLabel={scopeLabel}
            onBack={view.from ? () => setView(view.from!) : undefined}
            backLabel={view.from ? periodTitle(view.from.kind, view.from.range) : undefined}
          />
        ) : (
          <PeriodPanel
            key={`${scopeIndex}:${view.kind}:${view.range.from}`}
            kind={view.kind}
            branchQuery={branchQuery}
            canExport={canExport}
            range={view.range}
            today={today}
            tenantName={tenantName}
            scopeLabel={scopeLabel}
            onMove={(step) => setView({ kind: view.kind, range: shiftPeriod(view.kind, view.range, step) })}
            onOpenDay={(day) => setView({ kind: "day", day, from: view })}
          />
        )}
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="space-y-4" aria-label="Loading sales">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <TriangleAlert className="size-6 text-destructive/70" />
        {message}
      </CardContent>
    </Card>
  );
}

function trendAgainst(now: number, before: number) {
  const pct = changePct(now, before);
  return pct === null ? undefined : pct;
}

/** One method per row with its share as a bar — the question at closing is "how much cash?". */
function PaymentsCard({ totals }: { totals: SalesTotals }) {
  const paid = totals.byPaymentMethod.reduce((sum, p) => sum + p.amountPaisa, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">How customers paid</CardTitle>
        <CardDescription>Money taken, by payment method</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {totals.byPaymentMethod.length === 0 && <p className="text-sm text-muted-foreground">No payments.</p>}
        {totals.byPaymentMethod.map((p) => {
          const share = paid > 0 ? (p.amountPaisa / paid) * 100 : 0;
          return (
            <div key={p.method}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{METHOD_LABEL[p.method] ?? p.method}</span>
                <span className="tabular-nums">
                  {formatPkr(p.amountPaisa)}
                  <span className="ml-2 text-xs text-muted-foreground">{share.toFixed(0)}%</span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** The arithmetic from what was rung up to what was kept, one line at a time. */
function MoneyCard({ totals }: { totals: SalesTotals }) {
  // Discounts are listed as already taken off rather than added back to make a "before discounts"
  // figure: tax is charged on the discounted price, so no real bill ever came to that sum.
  const rows: { label: string; value: number; tone?: "minus" | "total" | "part" }[] = [
    { label: "Gross sales (what customers paid)", value: totals.grossPaisa },
    { label: "Refunds", value: totals.refundedPaisa, tone: "minus" },
    { label: "Net sales", value: totals.netPaisa, tone: "total" },
    { label: "Discounts given (already taken off)", value: totals.discountPaisa, tone: "part" },
    { label: "Tax collected (included)", value: totals.taxPaisa, tone: "part" },
    { label: "Service charge (included)", value: totals.serviceChargePaisa, tone: "part" },
    // Given free, at menu value: not part of any figure above, since nobody paid for it.
    ...(totals.complimentary.valuePaisa > 0
      ? [
          {
            label: `Complimentary (${totals.complimentary.itemCount} item${totals.complimentary.itemCount === 1 ? "" : "s"}, not charged)`,
            value: totals.complimentary.valuePaisa,
            tone: "part" as const,
          },
        ]
      : []),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Money breakdown</CardTitle>
        <CardDescription>What was taken, and what you kept</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {rows.map((r) => (
            <div
              key={r.label}
              className={cn(
                "flex items-baseline justify-between gap-3 py-2",
                r.tone === "total" && "font-heading text-base font-bold",
                r.tone === "part" && "text-muted-foreground"
              )}
            >
              <dt>{r.label}</dt>
              <dd className={cn("tabular-nums", r.tone === "minus" && r.value > 0 && "text-destructive")}>
                {r.tone === "minus" && r.value > 0 ? "− " : ""}
                {formatPkr(r.value)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function DayPanel({
  day,
  branchQuery,
  today,
  tenantName,
  scopeLabel,
  onBack,
  backLabel,
}: {
  day: string;
  /** "&branchId=…" when one branch is picked, empty for everything in scope. */
  branchQuery: string;
  today: string;
  tenantName: string;
  scopeLabel: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [printing, setPrinting] = useState(false);
  const { data, error, refreshing } = useReport<DayReport>(`/api/sales/day?date=${day}${branchQuery}`, reloadKey);

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {onBack && (
          <Button variant="link" className="h-auto px-0 text-sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back to {backLabel}
          </Button>
        )}
        <h2 className="font-heading text-xl font-semibold">
          {dayTitle(day, today)}
          {day === today || day === addDays(today, -1) ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{shortDay(day, true)}</span>
          ) : null}
        </h2>
        {day === today && <p className="text-sm text-muted-foreground">So far today — the day isn&apos;t over yet.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {day === today && (
          <Button variant="outline" className="h-10" disabled={refreshing} onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        )}
        <Button className="h-10" disabled={!data} onClick={() => setPrinting(true)}>
          <Printer className="size-4" />
          Print day summary
        </Button>
      </div>
    </div>
  );

  if (error) return (<>{header}<ErrorPanel message={error} /></>);
  if (!data) return (<>{header}<LoadingPanel /></>);

  const t = data.totals;
  const busiest = Math.max(1, ...data.byHour.map((h) => h.grossPaisa));

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="col-span-2 *:h-full lg:col-span-1">
          <StatCard label="Net sales" value={formatPkr(t.netPaisa)} icon={Banknote} hero trend={trendAgainst(t.netPaisa, data.compare.netPaisa)} />
        </div>
        <StatCard label="Orders" value={t.orderCount} icon={ShoppingBag} />
        <StatCard label="Average order" value={formatPkr(t.averageOrderPaisa)} icon={ReceiptText} />
        {/* Full width below the large-screen row, so it isn't left alone at half width, wrapping. */}
        <div className="col-span-2 *:h-full lg:col-span-1">
          <StatCard label="Refunds" value={formatPkr(t.refundedPaisa)} icon={Undo2} tone={t.refundedPaisa > 0 ? "warning" : undefined} />
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {data.compare.label[0].toUpperCase() + data.compare.label.slice(1)}: {formatPkr(data.compare.netPaisa)} from{" "}
        {data.compare.orderCount} {data.compare.orderCount === 1 ? "order" : "orders"}.
      </p>

      {(data.openOrders.count > 0 || data.voids.count > 0 || data.itemVoids.count > 0) && (
        <div className="mt-4 space-y-2">
          {data.openOrders.count > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <Clock className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <span>
                <strong>
                  {data.openOrders.count} {data.openOrders.count === 1 ? "order is" : "orders are"} still open
                </strong>{" "}
                worth about {formatPkr(data.openOrders.valuePaisa)}. {day === today ? "They" : "If they are paid, they"} will
                count on the day they are paid.
              </span>
            </div>
          )}
          {data.voids.count > 0 && (
            <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <strong>
                  {data.voids.count} {data.voids.count === 1 ? "order was" : "orders were"} voided
                </strong>{" "}
                ({formatPkr(data.voids.valuePaisa)}). Voided orders are not in the sales above.
              </span>
            </div>
          )}
          {data.itemVoids.count > 0 && (
            <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <strong>
                  {data.itemVoids.count} {data.itemVoids.count === 1 ? "item was" : "items were"} taken off orders
                </strong>{" "}
                ({formatPkr(data.itemVoids.valuePaisa)}). Who and why are in Reports → Discounts &amp; Voids.
              </span>
            </div>
          )}
        </div>
      )}

      {t.orderCount === 0 ? (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <ShoppingBag className="size-6 text-muted-foreground/50" />
            {day === today ? "No sales yet today." : "No sales on this day."}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <PaymentsCard totals={t} />
          <MoneyCard totals={t} />

          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Busiest hours</CardTitle>
              <CardDescription>Sales by the hour they were paid</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.byHour.map((h) => (
                <div key={h.hour} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-muted-foreground tabular-nums">{hourLabel(h.hour)}</span>
                  <div className="h-5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary/70" style={{ width: `${(h.grossPaisa / busiest) * 100}%` }} />
                  </div>
                  <span className="tabular-nums">
                    {formatPkr(h.grossPaisa)}
                    <span className="ml-1.5 text-xs text-muted-foreground">({h.orderCount})</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Order types</CardTitle>
              <CardDescription>Dine-in, takeaway and delivery</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm">
                {t.byOrderType.map((o) => (
                  <div key={o.type} className="flex items-baseline justify-between gap-3 py-2">
                    <dt>
                      {ORDER_TYPE_LABEL[o.type] ?? o.type}
                      <span className="ml-1.5 text-muted-foreground">
                        · {o.orderCount} {o.orderCount === 1 ? "order" : "orders"}
                      </span>
                    </dt>
                    <dd className="tabular-nums">{formatPkr(o.grossPaisa)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Best sellers</CardTitle>
              <CardDescription>Top {data.topItems.length} items by sales, before discounts</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topItems.map((i) => (
                    <TableRow key={i.name}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPkr(i.revenuePaisa)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading">By staff</CardTitle>
              <CardDescription>Who rang the orders up</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Net sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byStaff.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.orderCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPkr(s.netPaisa)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <ClosingDialog
        open={printing}
        onClose={() => setPrinting(false)}
        tenantName={tenantName}
        scopeLabel={scopeLabel}
        report={{ kind: "day", data, title: dayTitle(day, today) === "Today" ? "SALES SO FAR" : "DAY CLOSING" }}
      />
    </>
  );
}

function PeriodPanel({
  kind,
  branchQuery,
  canExport,
  range,
  today,
  tenantName,
  scopeLabel,
  onMove,
  onOpenDay,
}: {
  kind: "week" | "month";
  branchQuery: string;
  canExport: boolean;
  range: DayRange;
  today: string;
  tenantName: string;
  scopeLabel: string;
  onMove: (step: -1 | 1) => void;
  onOpenDay: (day: string) => void;
}) {
  const [printing, setPrinting] = useState(false);
  const shown = capAtToday(range, today);
  const { data, error } = useReport<PeriodReport>(`/api/sales/period?from=${shown.from}&to=${shown.to}${branchQuery}`, 0);
  const isCurrent = range.to >= today;
  const title = periodTitle(kind, range);

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-lg" aria-label={`Previous ${kind}`} onClick={() => onMove(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 px-2 text-center">
          <h2 className="font-heading text-xl font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {isCurrent ? `This ${kind}, so far` : kind === "week" ? "Monday to Sunday" : "Whole month"}
          </p>
        </div>
        <Button variant="outline" size="icon-lg" aria-label={`Next ${kind}`} disabled={isCurrent} onClick={() => onMove(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {canExport && (
        <Button
          variant="outline"
          className="h-10"
          disabled={!data}
          onClick={() =>
            data &&
            downloadCsv(
              `sales-${shown.from}-to-${shown.to}`,
              data.days.map((d) => ({
                Date: d.day,
                Orders: d.orderCount,
                "Gross (Rs)": paisaToRupees(d.grossPaisa),
                "Refunds (Rs)": paisaToRupees(d.refundedPaisa),
                "Net (Rs)": paisaToRupees(d.netPaisa),
                "Cash (Rs)": paisaToRupees(d.cashPaisa),
                "Card (Rs)": paisaToRupees(d.cardPaisa),
                "Other (Rs)": paisaToRupees(d.otherPaisa),
                "Tax (Rs)": paisaToRupees(d.taxPaisa),
              }))
            )
          }
        >
          <Download className="size-4" />
          Download
        </Button>
        )}
        <Button className="h-10" disabled={!data} onClick={() => setPrinting(true)}>
          <Printer className="size-4" />
          Print {kind === "week" ? "weekly" : "monthly"} closing
        </Button>
      </div>
    </div>
  );

  if (error) return (<>{header}<ErrorPanel message={error} /></>);
  if (!data) return (<>{header}<LoadingPanel /></>);

  const t = data.totals;
  const best = data.days.reduce<(typeof data.days)[number] | null>((b, d) => (d.netPaisa > (b?.netPaisa ?? 0) ? d : b), null);
  const totalOf = (key: "orderCount" | "grossPaisa" | "refundedPaisa" | "netPaisa" | "cashPaisa" | "cardPaisa" | "otherPaisa") =>
    data.days.reduce((sum, d) => sum + d[key], 0);

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="col-span-2 *:h-full lg:col-span-1">
          <StatCard label="Net sales" value={formatPkr(t.netPaisa)} icon={Banknote} hero trend={trendAgainst(t.netPaisa, data.compare.netPaisa)} />
        </div>
        <StatCard label="Orders" value={t.orderCount} icon={ShoppingBag} />
        <StatCard label="Average a day" value={formatPkr(Math.round(t.netPaisa / Math.max(1, data.days.length)))} icon={CalendarDays} />
        <div className="col-span-2 *:h-full lg:col-span-1">
          <StatCard label="Best day" value={best ? shortDay(best.day) : "—"} icon={ReceiptText} />
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {data.compare.label[0].toUpperCase() + data.compare.label.slice(1)}: {formatPkr(data.compare.netPaisa)} from{" "}
        {data.compare.orderCount} {data.compare.orderCount === 1 ? "order" : "orders"}.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-heading">Every day</CardTitle>
          <CardDescription>Tap a day to see everything that happened on it</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right max-md:hidden">Refunds</TableHead>
                <TableHead className="text-right max-md:hidden">Cash</TableHead>
                <TableHead className="text-right max-md:hidden">Card</TableHead>
                <TableHead className="text-right max-md:hidden">Other</TableHead>
                <TableHead className="w-8"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.days.map((d) => (
                <TableRow
                  key={d.day}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${shortDay(d.day, true)}`}
                  className={cn("h-12 cursor-pointer hover:bg-primary/5", d.orderCount === 0 && "text-muted-foreground")}
                  onClick={() => onOpenDay(d.day)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenDay(d.day);
                    }
                  }}
                >
                  <TableCell className="font-medium whitespace-nowrap">
                    {shortDay(d.day)}
                    {d.day === today && <span className="ml-1.5 text-xs text-primary">today</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.orderCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatPkr(d.netPaisa)}</TableCell>
                  <TableCell className="text-right tabular-nums max-md:hidden">{d.refundedPaisa > 0 ? formatPkr(d.refundedPaisa) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(d.cashPaisa)}</TableCell>
                  <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(d.cardPaisa)}</TableCell>
                  <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(d.otherPaisa)}</TableCell>
                  <TableCell className="text-muted-foreground"><ChevronRight className="size-4" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{totalOf("orderCount")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPkr(totalOf("netPaisa"))}</TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(totalOf("refundedPaisa"))}</TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(totalOf("cashPaisa"))}</TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(totalOf("cardPaisa"))}</TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">{formatPkr(totalOf("otherPaisa"))}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {t.orderCount > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <PaymentsCard totals={t} />
          <MoneyCard totals={t} />
        </div>
      )}

      <ClosingDialog
        open={printing}
        onClose={() => setPrinting(false)}
        tenantName={tenantName}
        scopeLabel={scopeLabel}
        report={{
          kind: "period",
          data,
          title: `${kind === "week" ? "WEEKLY" : "MONTHLY"} CLOSING${isCurrent ? " (SO FAR)" : ""}`,
          periodLabel: title,
        }}
      />
    </>
  );
}
