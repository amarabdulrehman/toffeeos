"use client";

import { useEffect, useMemo, useState } from "react";
import { subDays } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPkr } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";

function useDateRange() {
  const [from, setFrom] = useState(() => subDays(new Date(), 7).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const qs = useMemo(
    () => `from=${new Date(`${from}T00:00:00.000Z`).toISOString()}&to=${new Date(`${to}T23:59:59.999Z`).toISOString()}`,
    [from, to]
  );
  return { from, setFrom, to, setTo, qs };
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
    <div className="mb-4 flex items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-40" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-40" />
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const range = useDateRange();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="mb-4 text-muted-foreground">Owners see every branch; managers see their own.</p>

      <DateRangePicker from={range.from} to={range.to} onFrom={range.setFrom} onTo={range.setTo} />

      <Tabs defaultValue="sales">
        <TabsList className="flex-wrap">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="items">Item-wise</TabsTrigger>
          <TabsTrigger value="recipe">Recipe Cost</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="discounts">Discounts & Voids</TabsTrigger>
          <TabsTrigger value="valuation">Inventory Valuation</TabsTrigger>
          <TabsTrigger value="riders">Rider Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <SalesTab qs={range.qs} />
        </TabsContent>
        <TabsContent value="items" className="mt-4">
          <ItemWiseTab qs={range.qs} />
        </TabsContent>
        <TabsContent value="recipe" className="mt-4">
          <RecipeCostTab />
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <StaffTab qs={range.qs} />
        </TabsContent>
        <TabsContent value="discounts" className="mt-4">
          <DiscountVoidTab qs={range.qs} />
        </TabsContent>
        <TabsContent value="valuation" className="mt-4">
          <ValuationTab />
        </TabsContent>
        <TabsContent value="riders" className="mt-4">
          <RiderTab qs={range.qs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
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
  const [data, setData] = useState<SalesReport | null>(null);

  useEffect(() => {
    fetch(`/api/reports/sales-summary?${qs}`)
      .then((r) => r.json())
      .then(setData);
  }, [qs]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Orders" value={data?.orderCount ?? 0} />
        <StatCard label="Revenue" value={formatPkr(data?.totalPaisa ?? 0)} />
        <StatCard
          label="vs previous period"
          value={data?.previousPeriod.changePct !== null && data?.previousPeriod.changePct !== undefined
            ? `${data.previousPeriod.changePct >= 0 ? "+" : ""}${data.previousPeriod.changePct.toFixed(1)}%`
            : "—"}
        />
        <StatCard label="Previous period revenue" value={formatPkr(data?.previousPeriod.totalPaisa ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>By day</CardTitle>
            <ExportButton rows={data?.byDay ?? []} filename="sales-by-day" />
          </CardHeader>
          <CardContent>
            <Table>
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>By branch</CardTitle>
            <ExportButton rows={data?.byBranch ?? []} filename="sales-by-branch" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Branch</TableHead><TableHead>Orders</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data?.byBranch.map((b) => (
                  <TableRow key={b.branchId}>
                    <TableCell>{b.branchName}</TableCell>
                    <TableCell>{b.orders}</TableCell>
                    <TableCell className="text-right">{formatPkr(b.totalPaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>By category</CardTitle>
            <ExportButton rows={data?.byCategory ?? []} filename="sales-by-category" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Category</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data?.byCategory.map((c) => (
                  <TableRow key={c.category}>
                    <TableCell>{c.category}</TableCell>
                    <TableCell className="text-right">{formatPkr(c.revenuePaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>By payment method</CardTitle>
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
                    <TableCell>{p.method}</TableCell>
                    <TableCell className="text-right">{formatPkr(p.amountPaisa)}</TableCell>
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
  const [items, setItems] = useState<{ menuItemId: string; name: string; quantity: number; revenuePaisa: number }[]>([]);

  useEffect(() => {
    fetch(`/api/reports/item-wise?${qs}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []));
  }, [qs]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Item-wise sales</CardTitle>
        <ExportButton rows={items} filename="item-wise-sales" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.menuItemId}>
                <TableCell>{i.name}</TableCell>
                <TableCell>{i.quantity}</TableCell>
                <TableCell className="text-right">{formatPkr(i.revenuePaisa)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  const [items, setItems] = useState<RecipeCostRow[]>([]);

  useEffect(() => {
    fetch("/api/reports/recipe-cost")
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []));
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recipe cost & margin (worst margin first)</CardTitle>
        <ExportButton rows={items} filename="recipe-cost-margin" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Item</TableHead><TableHead>Price</TableHead><TableHead>Cost</TableHead><TableHead>Margin</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.menuItemId}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{formatPkr(r.basePricePaisa)}</TableCell>
                <TableCell>
                  {r.costPaisa !== null
                    ? formatPkr(r.costPaisa)
                    : r.hasRecipe
                      ? `Missing cost: ${r.missingCostIngredients.join(", ")}`
                      : "No recipe"}
                </TableCell>
                <TableCell className={r.marginPct !== null && r.marginPct < 30 ? "text-destructive" : ""}>
                  {r.marginPaisa !== null ? `${formatPkr(r.marginPaisa)} (${r.marginPct?.toFixed(0)}%)` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  const [rows, setRows] = useState<StaffRow[]>([]);

  useEffect(() => {
    fetch(`/api/reports/staff-performance?${qs}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []));
  }, [qs]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Staff performance (per staff per day)</CardTitle>
        <ExportButton rows={rows} filename="staff-performance" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead><TableHead>Day</TableHead><TableHead>Orders</TableHead>
              <TableHead>Avg order value</TableHead><TableHead>Discounts</TableHead><TableHead>Voids</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.staffId}-${r.day}-${i}`}>
                <TableCell>{r.staffName}</TableCell>
                <TableCell>{r.day}</TableCell>
                <TableCell>{r.orders}</TableCell>
                <TableCell>{formatPkr(r.avgOrderValuePaisa)}</TableCell>
                <TableCell className={r.discounts > 3 ? "font-semibold text-destructive" : ""}>{r.discounts}</TableCell>
                <TableCell className={r.voids > 2 ? "font-semibold text-destructive" : ""}>{r.voids}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  const [rows, setRows] = useState<DiscountVoidRow[]>([]);

  useEffect(() => {
    fetch(`/api/reports/discount-void?${qs}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []));
  }, [qs]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Discount & void audit trail</CardTitle>
        <ExportButton rows={rows} filename="discount-void-audit" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Type</TableHead><TableHead>Order #</TableHead><TableHead>Staff</TableHead><TableHead>Detail</TableHead><TableHead>Reason</TableHead><TableHead>When</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="capitalize">{r.kind}</TableCell>
                <TableCell>#{r.orderNumber}</TableCell>
                <TableCell>{r.actorName}</TableCell>
                <TableCell>{r.detail}</TableCell>
                <TableCell>{r.reason ?? "—"}</TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetch("/api/reports/inventory-valuation")
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setTotal(d.totalValuePaisa ?? 0);
      });
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Inventory valuation — total {formatPkr(total)}</CardTitle>
        <ExportButton rows={rows} filename="inventory-valuation" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Location</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Unit cost</TableHead><TableHead className="text-right">Value</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.locationName}</TableCell>
                <TableCell>{r.itemName}</TableCell>
                <TableCell>{r.quantity} {r.unitOfMeasure}</TableCell>
                <TableCell>{r.unitCostPaisa !== null ? formatPkr(r.unitCostPaisa) : "Unknown"}</TableCell>
                <TableCell className="text-right">{r.valuePaisa !== null ? formatPkr(r.valuePaisa) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  const [rows, setRows] = useState<RiderRow[]>([]);

  useEffect(() => {
    fetch(`/api/reports/rider-performance?${qs}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []));
  }, [qs]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Rider performance</CardTitle>
        <ExportButton rows={rows} filename="rider-performance" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Rider</TableHead><TableHead>Deliveries</TableHead><TableHead>Avg delivery time</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.riderId}>
                <TableCell>{r.riderName}</TableCell>
                <TableCell>{r.deliveries}</TableCell>
                <TableCell>{r.avgDeliveryMinutes} min</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
