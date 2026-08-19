"use client";

import { useEffect, useState } from "react";
import { subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPkr } from "@/lib/money";

interface SalesSummary {
  orderCount: number;
  totalPaisa: number;
  subtotalPaisa: number;
  taxPaisa: number;
  serviceChargePaisa: number;
  byDay: { day: string; orders: number; totalPaisa: number }[];
}

interface ItemWise {
  items: { menuItemId: string; name: string; quantity: number; revenuePaisa: number }[];
}

export default function ReportsPage() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [itemWise, setItemWise] = useState<ItemWise | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = subDays(to, 7);
    const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
    fetch(`/api/reports/sales-summary?${qs}`)
      .then((r) => r.json())
      .then(setSummary);
    fetch(`/api/reports/item-wise?${qs}`)
      .then((r) => r.json())
      .then(setItemWise);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="text-muted-foreground">Last 7 days</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Orders" value={summary?.orderCount ?? 0} />
        <StatCard label="Revenue" value={formatPkr(summary?.totalPaisa ?? 0)} />
        <StatCard label="Tax collected" value={formatPkr(summary?.taxPaisa ?? 0)} />
        <StatCard label="Service charge" value={formatPkr(summary?.serviceChargePaisa ?? 0)} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily sales</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary?.byDay.map((d) => (
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
          <CardHeader>
            <CardTitle>Item-wise sales</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemWise?.items.slice(0, 10).map((i) => (
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
      </div>
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
