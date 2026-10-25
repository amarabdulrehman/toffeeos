"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { subDays } from "date-fns";
import {
  BadgePercent,
  BarChart3,
  ChefHat,
  CircleDollarSign,
  ListOrdered,
  Lock,
  Package,
  Scale,
  TriangleAlert,
  Truck,
  Users,
  XCircle,
  Trash2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeletonRows } from "@/components/ui/table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { AreaTrendChart } from "@/components/charts/area-trend-chart";
import { RankedBarChart } from "@/components/charts/ranked-bar-chart";
import { formatPkr, paisaToRupees } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { DeleteOrderDialog, type DeletableOrder } from "@/components/orders/delete-order-dialog";

// Sales/staff/items stay always-on; the rest of the "full report suite" each need their own module
// toggle, per the same mapping used server-side to gate the underlying API routes (this is the UI
// half of the same decision) — see moduleForPermission in lib/tiers.ts. null = always visible.
const TAB_MODULE: Record<string, string | null> = {
  sales: null,
  transactions: null,
  items: null,
  staff: null,
  recipe: "costing", // "Recipe Cost" tab -> costing.viewMargins
  discounts: "reports",
  cancellations: "reports",
  valuation: "reports",
  riders: "delivery", // reports.riderPerformance.view is meaningless without Delivery
  // P&L rides the Expenses toggle, not the report-suite one: its cost side is expense data, and
  // without Expenses enabled it would show revenue with no costs — misleading, not just partial.
  pnl: "finance",
};

function useDateRange() {
  const [from, setFrom] = useState(() => subDays(new Date(), 7).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const qs = useMemo(() => {
    // The API resolves these "YYYY-MM-DD" strings against the branch's own timezone (see
    // resolveReportRange in src/server/reports.ts) — sending them as-is is what keeps this in sync
    // with the Cash Drawer's business day instead of silently reinterpreting them as UTC midnight.
    // Native <input type="date"> can hold an incomplete/invalid value while someone is mid-way
    // through typing a new date (or clears it); the day-string regex below rejects that shape and
    // falls back to the last 7 days instead of sending a half-typed date to the server.
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (DAY.test(from) && DAY.test(to)) {
      return `from=${from}&to=${to}`;
    }
    const now = new Date();
    return `from=${subDays(now, 7).toISOString().slice(0, 10)}&to=${now.toISOString().slice(0, 10)}`;
  }, [from, to]);
  return { from, setFrom, to, setTo, qs };
}

/** Every report tab goes through this instead of a bare fetch().then(setData) — a report a staff
 * member lacks permission for (or any other API failure) used to get silently treated as if it
 * were valid data and crash the tab trying to read fields off it. This checks res.ok first and
 * surfaces the server's own message instead. */
function useReportFetch<T>(url: string): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      setError(null);
      try {
        const r = await fetch(url);
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError(body.error ?? "Could not load this report.");
          return;
        }
        setData(body as T);
      } catch {
        if (!cancelled) setError("Could not load this report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, error, loading };
}

function ReportError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
      <Lock className="size-6 text-muted-foreground/50" />
      {message}
    </div>
  );
}

function DateRangePicker({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="mb-5 flex items-end gap-3 rounded-xl border bg-card p-3 shadow-xs">
      {/* htmlFor/id, not just a <Label> sitting above the field: without the pairing these read as
          two unlabelled date boxes to a screen reader, and clicking the word "From" does nothing. */}
      <div className="space-y-1.5">
        <Label htmlFor="report-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input id="report-from" type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="report-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input id="report-to" type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-40" />
      </div>
    </div>
  );
}

/**
 * reports.export: whether this person may download the figures, not only read them. Held as context
 * because the download buttons sit deep inside every tab, and a prop threaded through all of them
 * would be easy to miss on the next one added.
 */
const CanExport = createContext(false);

export function ReportsView({
  enabledModules,
  canExport = false,
  canDeleteOrders = false,
  showDeletionLog = false,
}: {
  enabledModules: string[];
  canExport?: boolean;
  canDeleteOrders?: boolean;
  showDeletionLog?: boolean;
}) {
  const range = useDateRange();
  const has = (tab: string) => {
    const mod = TAB_MODULE[tab];
    return mod === null || enabledModules.includes(mod);
  };

  return (
    <CanExport.Provider value={canExport}>
    <div className="p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BarChart3 className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">Owners see every branch; managers see their own.</p>
        </div>
      </div>

      <div className="mt-6">
        <DateRangePicker from={range.from} to={range.to} onFrom={range.setFrom} onTo={range.setTo} />
      </div>

      <Tabs defaultValue="sales">
        {/* This is the one tab bar in the app long enough to wrap (up to 9 tabs on a fully-enabled
            tenant), so it overrides two defaults that only suit short bars: `justify-center`, which
            strands a lone wrapped tab floating in the middle of row two, and the triggers' `flex-1`,
            which stretches each row's tabs to fill the width and makes the same tab a different
            size per row. Left-aligned and natural-width means a wrap reads as a deliberate second
            row instead of looking broken. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1 [&>*]:flex-none">
          <TabsTrigger value="sales" className="gap-1.5"><CircleDollarSign className="size-3.5" />Sales</TabsTrigger>
          {has("pnl") && <TabsTrigger value="pnl" className="gap-1.5"><Scale className="size-3.5" />P&amp;L</TabsTrigger>}
          <TabsTrigger value="transactions" className="gap-1.5"><ListOrdered className="size-3.5" />Transactions</TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5"><Package className="size-3.5" />Item-wise</TabsTrigger>
          {has("recipe") && <TabsTrigger value="recipe" className="gap-1.5"><ChefHat className="size-3.5" />Recipe Cost</TabsTrigger>}
          <TabsTrigger value="staff" className="gap-1.5"><Users className="size-3.5" />Staff</TabsTrigger>
          {has("discounts") && (
            <TabsTrigger value="discounts" className="gap-1.5"><BadgePercent className="size-3.5" />Discounts & Voids</TabsTrigger>
          )}
          {has("cancellations") && (
            <TabsTrigger value="cancellations" className="gap-1.5"><XCircle className="size-3.5" />Cancellations</TabsTrigger>
          )}
          {has("valuation") && (
            <TabsTrigger value="valuation" className="gap-1.5"><Package className="size-3.5" />Valuation</TabsTrigger>
          )}
          {/* "Riders", not "Rider Performance" — the Staff tab next to it is likewise just "Staff"
              and also shows performance, so the shorter label is the consistent one as well as the
              one that fits. Same reasoning for "Valuation" above. */}
          {has("riders") && (
            <TabsTrigger value="riders" className="gap-1.5"><Truck className="size-3.5" />Riders</TabsTrigger>
          )}
          {showDeletionLog && (
            <TabsTrigger value="deleted" className="gap-1.5"><Trash2 className="size-3.5" />Deleted orders</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <SalesTab qs={range.qs} />
        </TabsContent>
        {has("pnl") && (
          <TabsContent value="pnl" className="mt-4">
            <PnlTab qs={range.qs} />
          </TabsContent>
        )}
        <TabsContent value="transactions" className="mt-4">
          <TransactionsTab qs={range.qs} canDeleteOrders={canDeleteOrders} />
        </TabsContent>
        {showDeletionLog && (
          <TabsContent value="deleted" className="mt-4">
            <DeletedOrdersTab />
          </TabsContent>
        )}
        <TabsContent value="items" className="mt-4">
          <ItemWiseTab qs={range.qs} />
        </TabsContent>
        {has("recipe") && (
          <TabsContent value="recipe" className="mt-4">
            <RecipeCostTab />
          </TabsContent>
        )}
        <TabsContent value="staff" className="mt-4">
          <StaffTab qs={range.qs} />
        </TabsContent>
        {has("discounts") && (
          <TabsContent value="discounts" className="mt-4">
            <DiscountVoidTab qs={range.qs} />
          </TabsContent>
        )}
        {has("cancellations") && (
          <TabsContent value="cancellations" className="mt-4">
            <CancellationsTab />
          </TabsContent>
        )}
        {has("valuation") && (
          <TabsContent value="valuation" className="mt-4">
            <ValuationTab />
          </TabsContent>
        )}
        {has("riders") && (
          <TabsContent value="riders" className="mt-4">
            <RiderTab qs={range.qs} />
          </TabsContent>
        )}
      </Tabs>
    </div>
    </CanExport.Provider>
  );
}


function ExportButton<T extends object>({ rows, filename }: { rows: T[]; filename: string }) {
  if (!useContext(CanExport)) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={rows.length === 0}
      onClick={() => downloadCsv(filename, rows as Record<string, unknown>[])}
    >
      Export CSV
    </Button>
  );
}

interface SalesReport {
  orderCount: number;
  totalPaisa: number;
  byDay: { day: string; orders: number; totalPaisa: number }[];
  byBranch: { branchId: string; branchName: string; orders: number; totalPaisa: number }[];
  byCategory: { category: string; orders: number; revenuePaisa: number }[];
  byPaymentMethod: { method: string; amountPaisa: number }[];
  previousPeriod: { orderCount: number; totalPaisa: number; changePct: number | null };
}

function SalesTab({ qs }: { qs: string }) {
  const { data, error, loading } = useReportFetch<SalesReport>(`/api/reports/sales-summary?${qs}`);

  if (error) {
    return (
      <Card className="shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="pt-6">
          <ReportError message={error} />
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="space-y-2 pt-6">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="shadow-md">
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[220px] w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Orders" value={data?.orderCount ?? 0} icon={Package} />
        <StatCard
          label="Revenue"
          value={formatPkr(data?.totalPaisa ?? 0)}
          icon={CircleDollarSign}
          trend={data?.previousPeriod.changePct ?? null}
          hero
        />
        <StatCard label="Previous period orders" value={data?.previousPeriod.orderCount ?? 0} icon={Package} />
        <StatCard label="Previous period revenue" value={formatPkr(data?.previousPeriod.totalPaisa ?? 0)} icon={CircleDollarSign} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden shadow-md ring-1 ring-primary/10 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-b from-primary/[0.06] to-transparent">
            <CardTitle className="font-heading">Revenue trend</CardTitle>
            <ExportButton rows={data?.byDay ?? []} filename="sales-by-day" />
          </CardHeader>
          <CardContent>
            <AreaTrendChart
              data={data?.byDay ?? []}
              xKey="day"
              yKey="totalPaisa"
              height={220}
            />
            <Table className="mt-4">
              <TableHeader>
                <TableRow><TableHead>Day</TableHead><TableHead>Orders</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data?.byDay.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{d.day}</TableCell>
                    <TableCell>{d.orders}</TableCell>
                    <TableCell className="text-right">{formatPkr(d.totalPaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-heading">By branch</CardTitle>
            <ExportButton rows={data?.byBranch ?? []} filename="sales-by-branch" />
          </CardHeader>
          <CardContent>
            <RankedBarChart
              rows={(data?.byBranch ?? []).map((b) => ({ label: b.branchName, value: b.totalPaisa }))}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-heading">By category</CardTitle>
            <ExportButton rows={data?.byCategory ?? []} filename="sales-by-category" />
          </CardHeader>
          <CardContent>
            <RankedBarChart
              rows={(data?.byCategory ?? []).map((c) => ({ label: c.category, value: c.revenuePaisa }))}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-heading">By payment method</CardTitle>
            <ExportButton rows={data?.byPaymentMethod ?? []} filename="sales-by-payment-method" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data?.byPaymentMethod.map((p) => (
                  <TableRow key={p.method}>
                    <TableCell className="font-medium capitalize">{p.method.replace(/_/g, " ").toLowerCase()}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatPkr(p.amountPaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ItemWiseTab({ qs }: { qs: string }) {
  const { data, error, loading } = useReportFetch<{
    items: { menuItemId: string; variantId: string | null; name: string; quantity: number; revenuePaisa: number }[];
  }>(
    `/api/reports/item-wise?${qs}`
  );
  const items = data?.items ?? [];

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Item-wise sales</CardTitle>
        <ExportButton rows={items} filename="item-wise-sales" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-32", "w-10", "w-20"]} align={["left", "left", "right"]} />}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No sales in this range.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                items.map((i) => (
                  <TableRow key={`${i.menuItemId}:${i.variantId ?? ""}`}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell className="tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatPkr(i.revenuePaisa)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface RecipeCostRow {
  menuItemId: string;
  name: string;
  basePricePaisa: number;
  costPaisa: number | null;
  marginPaisa: number | null;
  marginPct: number | null;
  hasRecipe: boolean;
  missingCostIngredients: string[];
}

function RecipeCostTab() {
  const { data, error, loading } = useReportFetch<{ items: RecipeCostRow[] }>("/api/reports/recipe-cost");
  const items = data?.items ?? [];

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Recipe cost & margin (worst margin first)</CardTitle>
        <ExportButton rows={items} filename="recipe-cost-margin" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Item</TableHead><TableHead>Price</TableHead><TableHead>Cost</TableHead><TableHead>Margin</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-32", "w-16", "w-16", "w-20"]} />}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No active menu items yet.
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.map((r) => (
                <TableRow key={r.menuItemId}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{formatPkr(r.basePricePaisa)}</TableCell>
                  <TableCell>
                    {r.costPaisa !== null ? (
                      formatPkr(r.costPaisa)
                    ) : r.hasRecipe ? (
                      <Badge variant="warning" className="font-normal">Missing cost: {r.missingCostIngredients.join(", ")}</Badge>
                    ) : (
                      <Badge variant="outline" className="font-normal text-muted-foreground">No recipe</Badge>
                    )}
                  </TableCell>
                  <TableCell className={`font-medium ${r.marginPct !== null && r.marginPct < 30 ? "text-destructive" : r.marginPct !== null ? "text-success" : ""}`}>
                    {r.marginPaisa !== null ? `${formatPkr(r.marginPaisa)} (${r.marginPct?.toFixed(0)}%)` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface StaffRow {
  staffId: string;
  staffName: string;
  day: string;
  orders: number;
  totalPaisa: number;
  avgOrderValuePaisa: number;
  discounts: number;
  voids: number;
}

function StaffTab({ qs }: { qs: string }) {
  const { data, error, loading } = useReportFetch<{ rows: StaffRow[] }>(`/api/reports/staff-performance?${qs}`);
  const rows = data?.rows ?? [];

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Staff performance (per staff per day)</CardTitle>
        <ExportButton rows={rows} filename="staff-performance" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead><TableHead>Day</TableHead><TableHead>Orders</TableHead>
                <TableHead>Avg order value</TableHead><TableHead>Discounts</TableHead><TableHead>Voids</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-24", "w-20", "w-8", "w-16", "w-6", "w-6"]} rows={4} />}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No staff activity in this range.
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.map((r, i) => (
                <TableRow key={`${r.staffId}-${r.day}-${i}`}>
                  <TableCell className="font-medium">{r.staffName}</TableCell>
                  <TableCell className="text-muted-foreground">{r.day}</TableCell>
                  <TableCell className="tabular-nums">{r.orders}</TableCell>
                  <TableCell className="tabular-nums">{formatPkr(r.avgOrderValuePaisa)}</TableCell>
                  <TableCell className={`tabular-nums ${r.discounts > 3 ? "font-semibold text-destructive" : ""}`}>{r.discounts}</TableCell>
                  <TableCell className={`tabular-nums ${r.voids > 2 ? "font-semibold text-destructive" : ""}`}>{r.voids}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface DiscountVoidRow {
  kind: "discount" | "void" | "complimentary";
  orderNumber: number;
  actorName: string;
  detail: string;
  reason: string | null;
  createdAt: string;
}

function DiscountVoidTab({ qs }: { qs: string }) {
  const { data, error, loading } = useReportFetch<{ rows: DiscountVoidRow[] }>(`/api/reports/discount-void?${qs}`);
  const rows = data?.rows ?? [];

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Discount & void audit trail</CardTitle>
        <ExportButton rows={rows} filename="discount-void-audit" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Type</TableHead><TableHead>Order #</TableHead><TableHead>Staff</TableHead><TableHead>Detail</TableHead><TableHead>Reason</TableHead><TableHead>When</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-14", "w-10", "w-24", "w-28", "w-20", "w-28"]} rows={4} />}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No discounts or voids in this range.
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge variant={r.kind === "void" ? "destructive" : r.kind === "complimentary" ? "secondary" : "warning"} className="capitalize">{r.kind}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">#{r.orderNumber}</TableCell>
                  <TableCell className="font-medium">{r.actorName}</TableCell>
                  <TableCell>{r.detail}</TableCell>
                  <TableCell className="text-muted-foreground">{r.reason ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface CancellationRow {
  id: string;
  orderNumber: number | null;
  orderType: string | null;
  totalPaisa: number | null;
  reason: string;
  cancelledByName: string;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

/** Not date-ranged like the other tabs — this is a review queue (what needs a manager/owner's
 * attention) as much as a historical report, so it always shows the most recent 100 regardless of
 * the page's date picker. See cancelSentOrder in src/server/orders.ts for how these rows get
 * created — every one of them is a cashier cancelling an order already sent to the kitchen. */
function CancellationsTab() {
  const { data, error, loading } = useReportFetch<{ cancellations: CancellationRow[] }>("/api/order-cancellations");
  // Optimistic local overrides for rows just marked reviewed — avoids re-deriving state from the
  // fetched `data` in an effect (which only ever needs to run once per fetch anyway).
  const [reviewedOverrides, setReviewedOverrides] = useState<Record<string, { reviewedAt: string; reviewedByName: string }>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const rows = (data?.cancellations ?? []).map((r) => (reviewedOverrides[r.id] ? { ...r, ...reviewedOverrides[r.id] } : r));

  async function markReviewed(id: string) {
    setReviewingId(id);
    try {
      const res = await fetch(`/api/order-cancellations/${id}/review`, { method: "POST" });
      if (!res.ok) return;
      setReviewedOverrides((prev) => ({ ...prev, [id]: { reviewedAt: new Date().toISOString(), reviewedByName: "You" } }));
    } finally {
      setReviewingId(null);
    }
  }

  const unreviewedCount = rows.filter((r) => !r.reviewedAt).length;

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="font-heading">Order cancellations</CardTitle>
          {unreviewedCount > 0 && (
            <p className="mt-1 text-sm text-destructive">{unreviewedCount} awaiting review</p>
          )}
        </div>
        <ExportButton rows={rows} filename="order-cancellations" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Cancelled by</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-10", "w-16", "w-32", "w-24", "w-28", "w-24"]} rows={4} />}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No cancellations — every sent-to-kitchen order has run its course.
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.map((r) => (
                <TableRow key={r.id} className={!r.reviewedAt ? "bg-destructive/[0.03]" : undefined}>
                  <TableCell className="tabular-nums">{r.orderNumber ? `#${r.orderNumber}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{r.totalPaisa !== null ? formatPkr(r.totalPaisa) : "—"}</TableCell>
                  <TableCell className="max-w-64">{r.reason}</TableCell>
                  <TableCell className="font-medium">{r.cancelledByName}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {r.reviewedAt ? (
                      <Badge variant="outline">Reviewed by {r.reviewedByName}</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => markReviewed(r.id)} disabled={reviewingId === r.id}>
                        {reviewingId === r.id ? "Marking…" : "Mark reviewed"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface ValuationRow {
  locationName: string;
  itemName: string;
  unitOfMeasure: string;
  quantity: number;
  unitCostPaisa: number | null;
  valuePaisa: number | null;
}

function ValuationTab() {
  const { data, error, loading } = useReportFetch<{ rows: ValuationRow[]; totalValuePaisa: number }>("/api/reports/inventory-valuation");
  const rows = data?.rows ?? [];
  const total = data?.totalValuePaisa ?? 0;

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">
          Inventory valuation — total{" "}
          {loading ? <Skeleton className="inline-block h-5 w-20 align-middle" /> : <span className="text-primary">{formatPkr(total)}</span>}
        </CardTitle>
        <ExportButton rows={rows} filename="inventory-valuation" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Location</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Unit cost</TableHead><TableHead className="text-right">Value</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-20", "w-28", "w-16", "w-16", "w-16"]} align={["left", "left", "left", "left", "right"]} />}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No stock recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-muted-foreground">{r.locationName}</TableCell>
                  <TableCell className="font-medium">{r.itemName}</TableCell>
                  <TableCell className="tabular-nums">{r.quantity} {r.unitOfMeasure}</TableCell>
                  <TableCell className="tabular-nums">{r.unitCostPaisa !== null ? formatPkr(r.unitCostPaisa) : "Unknown"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.valuePaisa !== null ? formatPkr(r.valuePaisa) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface RiderRow {
  riderId: string;
  riderName: string;
  deliveries: number;
  avgDeliveryMinutes: number;
}

function RiderTab({ qs }: { qs: string }) {
  const { data, error, loading } = useReportFetch<{ rows: RiderRow[] }>(`/api/reports/rider-performance?${qs}`);
  const rows = data?.rows ?? [];

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Rider performance</CardTitle>
        <ExportButton rows={rows} filename="rider-performance" />
      </CardHeader>
      <CardContent>
        {error ? (
          <ReportError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Rider</TableHead><TableHead>Deliveries</TableHead><TableHead>Avg delivery time</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableSkeletonRows widths={["w-24", "w-10", "w-16"]} rows={3} />}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No deliveries in this range.
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.map((r) => (
                <TableRow key={r.riderId}>
                  <TableCell className="font-medium">{r.riderName}</TableCell>
                  <TableCell className="tabular-nums">{r.deliveries}</TableCell>
                  <TableCell className="tabular-nums">{r.avgDeliveryMinutes} min</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface PnlReportData {
  grossSalesPaisa: number;
  refundsPaisa: number;
  salesTaxPaisa: number;
  netRevenuePaisa: number;
  orderCount: number;
  stockPurchasesPaisa: number;
  stockPurchasesMissingCost: number;
  salariesPaisa: number;
  expensesPaisa: number;
  expensesByCategory: { category: string; amountPaisa: number }[];
  totalCostsPaisa: number;
  netProfitPaisa: number;
  marginPct: number | null;
}

/** One line of the statement. `emphasis` marks a subtotal row; `deduction` wraps the value in
 * parentheses — the accounting convention for a subtraction — so the arithmetic reads correctly
 * down the column instead of looking like a list of unrelated positive numbers. */
function PnlRow({
  label,
  amountPaisa,
  emphasis,
  deduction,
  indent,
  hint,
}: {
  label: string;
  amountPaisa: number;
  emphasis?: boolean;
  deduction?: boolean;
  indent?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        emphasis ? "border-t font-semibold" : "text-sm"
      } ${indent ? "pl-4" : ""}`}
    >
      <span className={emphasis ? "" : "text-muted-foreground"}>
        {label}
        {hint && <span className="ml-2 text-xs text-muted-foreground/70">{hint}</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        {deduction ? `(${formatPkr(amountPaisa)})` : formatPkr(amountPaisa)}
      </span>
    </div>
  );
}

interface TransactionsReport {
  rows: {
    orderId: string;
    orderNumber: number;
    paidAt: string;
    branchName: string;
    type: string;
    source: string;
    tableName: string | null;
    customerName: string | null;
    servedBy: string | null;
    itemCount: number;
    items: string;
    subtotalPaisa: number;
    discountPaisa: number;
    serviceChargePaisa: number;
    taxPaisa: number;
    deliveryFeePaisa: number;
    roundingPaisa: number;
    totalPaisa: number;
    paymentMethods: string;
    invoiceNumber: string | null;
  }[];
  truncated: boolean;
  limit: number;
  totalPaisa: number;
}

/**
 * Every sale in the range, one row each — the itemised record behind the Sales tab's totals.
 *
 * The export carries more columns than the table does. On screen, ten columns is already the most
 * that stays readable; in a spreadsheet the whole point is having every field to filter and pivot
 * on, so nothing is dropped there. Money is exported in rupees rather than paisa because the
 * destination is a spreadsheet, where a person sums the column and expects rupees.
 */
function TransactionsTab({ qs, canDeleteOrders = false }: { qs: string; canDeleteOrders?: boolean }) {
  // Bumped after a delete so the list, its count and its total all come back without the order.
  const [reloadKey, setReloadKey] = useState(0);
  const [deleting, setDeleting] = useState<DeletableOrder | null>(null);
  const { data, error, loading } = useReportFetch<TransactionsReport>(
    `/api/reports/transactions?${qs}${reloadKey ? `&r=${reloadKey}` : ""}`
  );

  if (error) {
    return (
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <ReportError message={error} />
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const exportRows = data.rows.map((r) => ({
    "Order #": r.orderNumber,
    "Paid at": new Date(r.paidAt).toLocaleString(),
    Branch: r.branchName,
    Type: r.type,
    Source: r.source,
    Table: r.tableName ?? "",
    Customer: r.customerName ?? "",
    "Served by": r.servedBy ?? "",
    Items: r.items,
    "Item count": r.itemCount,
    Subtotal: paisaToRupees(r.subtotalPaisa),
    Discount: paisaToRupees(r.discountPaisa),
    "Service charge": paisaToRupees(r.serviceChargePaisa),
    Tax: paisaToRupees(r.taxPaisa),
    "Delivery fee": paisaToRupees(r.deliveryFeePaisa),
    Rounding: paisaToRupees(r.roundingPaisa),
    Total: paisaToRupees(r.totalPaisa),
    Payment: r.paymentMethods,
    Invoice: r.invoiceNumber ?? "",
  }));

  return (
    <>
    <Card className="shadow-md">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="font-heading">Every sale in this period</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.rows.length.toLocaleString()} {data.rows.length === 1 ? "sale" : "sales"} ·{" "}
              {formatPkr(data.totalPaisa)}
            </p>
          </div>
          <ExportButton rows={exportRows} filename="transactions" />
        </CardHeader>
        <CardContent>
          {data.truncated && (
            <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              Showing the most recent {data.limit.toLocaleString()} sales. Narrow the date range to see
              the rest — the export covers only what is shown.
            </p>
          )}
          {data.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Served by</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {canDeleteOrders && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.orderId}>
                      <TableCell className="font-medium tabular-nums">#{r.orderNumber}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(r.paidAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.branchName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.type}</Badge>
                      </TableCell>
                      {/* The full list is in the export; on screen it is truncated so one large order
                          cannot push every money column off the right edge. */}
                      <TableCell className="max-w-[22rem] truncate" title={r.items}>
                        {r.items || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{r.servedBy ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{r.paymentMethods || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.discountPaisa > 0 ? `-${formatPkr(r.discountPaisa)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatPkr(r.taxPaisa)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatPkr(r.totalPaisa)}</TableCell>
                      {canDeleteOrders && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete order #${r.orderNumber}`}
                            onClick={() =>
                              setDeleting({ id: r.orderId, orderNumber: r.orderNumber, totalPaisa: r.totalPaisa, paid: true })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <DeleteOrderDialog
        order={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setReloadKey((k) => k + 1);
        }}
      />
    </>
  );
}

function PnlTab({ qs }: { qs: string }) {
  const canExportPnl = useContext(CanExport);
  const { data, error, loading } = useReportFetch<PnlReportData>(`/api/reports/pnl?${qs}`);

  if (error) {
    return (
      <Card className="shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="pt-6">
          <ReportError message={error} />
        </CardContent>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="space-y-2 pt-6">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="shadow-md">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const profitable = data.netProfitPaisa >= 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Net revenue" value={formatPkr(data.netRevenuePaisa)} icon={CircleDollarSign} />
        <StatCard label="Total costs" value={formatPkr(data.totalCostsPaisa)} icon={Package} />
        <StatCard
          label={profitable ? "Net profit" : "Net loss"}
          value={formatPkr(Math.abs(data.netProfitPaisa))}
          icon={Scale}
          tone={profitable ? "success" : "destructive"}
          hero
        />
        <StatCard
          label="Margin"
          value={data.marginPct === null ? "—" : `${data.marginPct.toFixed(1)}%`}
          icon={BarChart3}
          tone={data.marginPct !== null && data.marginPct < 0 ? "destructive" : undefined}
        />
      </div>

      <Card className="shadow-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading">Profit &amp; loss statement</CardTitle>
          {canExportPnl && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              // toCsv takes header names from the first row's keys, so every row must be an
              // object with the same shape. Costs are exported negative so the column sums to
              // net profit in a spreadsheet.
              downloadCsv("profit-and-loss", [
                { line: "Gross sales", amountRs: (data.grossSalesPaisa / 100).toFixed(2) },
                { line: "Less: refunds", amountRs: (-data.refundsPaisa / 100).toFixed(2) },
                { line: "Less: sales tax collected", amountRs: (-data.salesTaxPaisa / 100).toFixed(2) },
                { line: "Net revenue", amountRs: (data.netRevenuePaisa / 100).toFixed(2) },
                { line: "Stock purchases", amountRs: (-data.stockPurchasesPaisa / 100).toFixed(2) },
                { line: "Salaries paid", amountRs: (-data.salariesPaisa / 100).toFixed(2) },
                ...data.expensesByCategory.map((c) => ({
                  line: `Expense: ${c.category}`,
                  amountRs: (-c.amountPaisa / 100).toFixed(2),
                })),
                { line: "Total costs", amountRs: (-data.totalCostsPaisa / 100).toFixed(2) },
                { line: "Net profit", amountRs: (data.netProfitPaisa / 100).toFixed(2) },
              ])
            }
          >
            Export CSV
          </Button>
          )}
        </CardHeader>
        <CardContent>
          <PnlRow label="Gross sales" amountPaisa={data.grossSalesPaisa} hint={`${data.orderCount} paid orders`} />
          {/* Shown only when there were refunds: a permanent "Less: refunds — Rs 0" row on every
              café's P&L is noise, but a month with refunds in it must say so, or the gross figure
              above and the net below look like they disagree. */}
          {data.refundsPaisa > 0 && (
            <PnlRow label="Less: refunds" amountPaisa={data.refundsPaisa} deduction indent />
          )}
          <PnlRow label="Less: sales tax collected" amountPaisa={data.salesTaxPaisa} deduction indent />
          <PnlRow label="Net revenue" amountPaisa={data.netRevenuePaisa} emphasis />

          <div className="mt-4" />
          <PnlRow
            label="Stock purchases"
            amountPaisa={data.stockPurchasesPaisa}
            deduction
            hint={
              data.stockPurchasesMissingCost > 0
                ? `${data.stockPurchasesMissingCost} receipt${data.stockPurchasesMissingCost === 1 ? "" : "s"} with no cost recorded`
                : undefined
            }
          />
          <PnlRow label="Salaries paid" amountPaisa={data.salariesPaisa} deduction />
          <PnlRow label="Expenses" amountPaisa={data.expensesPaisa} deduction />
          {data.expensesByCategory.map((c) => (
            <PnlRow key={c.category} label={c.category} amountPaisa={c.amountPaisa} deduction indent />
          ))}
          <PnlRow label="Total costs" amountPaisa={data.totalCostsPaisa} deduction emphasis />

          <div className="mt-4" />
          <div className="flex items-baseline justify-between gap-4 border-t-2 py-3">
            <span className="font-heading text-base font-bold">{profitable ? "Net profit" : "Net loss"}</span>
            <span
              className={`shrink-0 text-lg font-bold tabular-nums ${profitable ? "text-success" : "text-destructive"}`}
            >
              {formatPkr(Math.abs(data.netProfitPaisa))}
            </span>
          </div>
        </CardContent>
      </Card>

      {data.expensesByCategory.length > 0 && (
        <Card className="shadow-sm transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="font-heading">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarChart
              rows={data.expensesByCategory.map((c) => ({ label: c.category, value: c.amountPaisa }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Stating the method plainly, because every line above can legitimately differ from what an
          accountant would produce, and an owner acting on a number they've misread is worse off
          than one who knows the number's limits. */}
      <Card className="border-dashed shadow-none">
        <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <TriangleAlert className="size-4 text-warning-foreground" />
            How to read this
          </div>
          <p>
            This is a <strong>cash-basis</strong> summary — money that came in versus money that went
            out in this period. It is not full accrual accounting, and it is not a tax return.
          </p>
          <p>
            <strong>Stock is counted when bought, not when used.</strong> A month with a big restock
            looks worse than it really was, and the next month looks better. Over a quarter it evens
            out. A true cost-of-goods figure would need a recipe set on every menu item.
          </p>
          <p>
            <strong>Sales tax is excluded from revenue</strong> — it is collected for the FBR/PRA and
            passed on, so it was never income. Gross sales above still matches the Sales tab exactly.
          </p>
          <p>
            <strong>Don&apos;t record the same cost twice.</strong> If a supplier delivery is entered
            as a stock receipt with a cost, don&apos;t also log it as an expense — and leave staff
            wages to Payroll rather than adding a &ldquo;Salaries&rdquo; expense.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface OrderDeletionRow {
  id: string;
  orderNumber: number;
  branchName: string;
  orderType: string;
  previousStatus: string;
  totalPaisa: number;
  paidPaisa: number;
  refundedPaisa: number;
  payments: { method: string; amountPaisa: number }[];
  lines: { name: string; quantity: number; lineTotalPaisa: number }[];
  orderCreatedAt: string;
  reason: string;
  restocked: boolean;
  deletedByName: string;
  createdAt: string;
}

/**
 * Every order the owner has deleted: what it was, who removed it, when and why. Nothing on this
 * screen — or anywhere in the app — can remove an entry; the database won't let the app.
 */
function DeletedOrdersTab() {
  const { data, error, loading } = useReportFetch<{ deletions: OrderDeletionRow[] }>("/api/orders/deletions");

  if (error) {
    return (
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <ReportError message={error} />
        </CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card className="shadow-md">
        <CardContent className="space-y-2 pt-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Deleted orders</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          A permanent record. Entries can&apos;t be edited or removed.
        </p>
      </CardHeader>
      <CardContent>
        {data.deletions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No orders have been deleted.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deleted</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deletions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium tabular-nums">#{d.orderNumber}</span>
                      <span className="block text-xs text-muted-foreground">
                        {d.previousStatus.replace(/_/g, " ").toLowerCase()} · {new Date(d.orderCreatedAt).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{d.branchName}</TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={d.lines.map((l) => `${l.quantity}x ${l.name}`).join(", ")}>
                      {d.lines.map((l) => `${l.quantity}x ${l.name}`).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.payments.length > 0 ? d.payments.map((p) => p.method).join(", ") : "Unpaid"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatPkr(d.totalPaisa)}</TableCell>
                    <TableCell className="max-w-[16rem]">{d.reason}</TableCell>
                    <TableCell className="whitespace-nowrap">{d.deletedByName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.restocked ? "Put back" : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
