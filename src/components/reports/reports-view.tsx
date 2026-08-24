"use client";

import { useEffect, useMemo, useState } from "react";
import { subDays } from "date-fns";
import {
  BadgePercent,
  BarChart3,
  ChefHat,
  CircleDollarSign,
  Lock,
  Package,
  Truck,
  Users,
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
import { formatPkr } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";

// Sales/staff/items stay always-on; the rest of the "full report suite" each need their own module
// toggle, per the same mapping used server-side to gate the underlying API routes (this is the UI
// half of the same decision) — see moduleForPermission in lib/tiers.ts. null = always visible.
const TAB_MODULE: Record<string, string | null> = {
  sales: null,
  items: null,
  staff: null,
  recipe: "costing", // "Recipe Cost" tab -> costing.viewMargins
  discounts: "reports",
  valuation: "reports",
  riders: "delivery", // reports.riderPerformance.view is meaningless without Delivery
};

function useDateRange() {
  const [from, setFrom] = useState(() => subDays(new Date(), 7).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const qs = useMemo(() => {
    // Native <input type="date"> can hold an incomplete/invalid value while someone is mid-way
    // through typing a new date (or clears it), which makes `new Date(...).toISOString()` throw
    // rather than return a garbage-but-safe value — fall back to the last 7 days instead of
    // crashing the whole report on every such keystroke.
    try {
      const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
      return `from=${fromIso}&to=${toIso}`;
    } catch {
      const now = new Date();
      return `from=${subDays(now, 7).toISOString()}&to=${now.toISOString()}`;
    }
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
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-40" />
      </div>
    </div>
  );
}

export function ReportsView({ enabledModules }: { enabledModules: string[] }) {
  const range = useDateRange();
  const has = (tab: string) => {
    const mod = TAB_MODULE[tab];
    return mod === null || enabledModules.includes(mod);
  };

  return (
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
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
          <TabsTrigger value="sales" className="gap-1.5"><CircleDollarSign className="size-3.5" />Sales</TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5"><Package className="size-3.5" />Item-wise</TabsTrigger>
          {has("recipe") && <TabsTrigger value="recipe" className="gap-1.5"><ChefHat className="size-3.5" />Recipe Cost</TabsTrigger>}
          <TabsTrigger value="staff" className="gap-1.5"><Users className="size-3.5" />Staff</TabsTrigger>
          {has("discounts") && (
            <TabsTrigger value="discounts" className="gap-1.5"><BadgePercent className="size-3.5" />Discounts & Voids</TabsTrigger>
          )}
          {has("valuation") && (
            <TabsTrigger value="valuation" className="gap-1.5"><Package className="size-3.5" />Inventory Valuation</TabsTrigger>
          )}
          {has("riders") && (
            <TabsTrigger value="riders" className="gap-1.5"><Truck className="size-3.5" />Rider Performance</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <SalesTab qs={range.qs} />
        </TabsContent>
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
  );
}


function ExportButton<T extends object>({ rows, filename }: { rows: T[]; filename: string }) {
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
  const { data, error, loading } = useReportFetch<{ items: { menuItemId: string; name: string; quantity: number; revenuePaisa: number }[] }>(
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
                  <TableRow key={i.menuItemId}>
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
  kind: "discount" | "void";
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
                    <Badge variant={r.kind === "void" ? "destructive" : "warning"} className="capitalize">{r.kind}</Badge>
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
