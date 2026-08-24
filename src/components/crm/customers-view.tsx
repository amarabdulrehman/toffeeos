"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CircleDollarSign, Lock, Search, Trophy, UserRound, Users } from "lucide-react";
import { RankedBarChart } from "@/components/charts/ranked-bar-chart";
import { formatPkr } from "@/lib/money";

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  totalOrders: number;
  totalSpendPaisa: number;
  lastOrderAt: string | null;
}

interface CustomerOrder {
  id: string;
  orderNumber: number;
  type: string;
  status: string;
  totalPaisa: number;
  createdAt: string;
  paidAt: string | null;
  branch: { name: string };
}

interface CustomerDetail {
  customer: { id: string; name: string | null; phone: string | null; email: string | null; whatsappOptOut: boolean };
  orders: CustomerOrder[];
  totalOrders: number;
  totalSpendPaisa: number;
  lastOrderAt: string | null;
}

function initials(name: string | null, phone: string | null): string {
  if (name) return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return phone ? phone.slice(-2) : "?";
}

// Same status vocabulary used everywhere an order status shows up (KDS, POS queue, Online
// Ordering) — one status should read as the same color no matter which screen it's on.
const ORDER_STATUS_VARIANT: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
  OPEN: "secondary",
  SENT_TO_KITCHEN: "warning",
  READY: "default",
  SERVED: "default",
  PAID: "success",
  DELIVERED: "success",
  VOIDED: "destructive",
  CANCELLED: "destructive",
};

export function CustomersView() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    const url = inactiveOnly ? "/api/customers/inactive?days=30" : `/api/customers?q=${encodeURIComponent(query)}`;
    (async () => {
      setError(null);
      try {
        const r = await fetch(url);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(body.error ?? "Could not load customers.");
          setCustomers([]);
          return;
        }
        setCustomers(body.customers ?? []);
      } catch {
        setError("Could not load customers.");
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [query, inactiveOnly]);

  useEffect(load, [load]);

  return (
    <div className="p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">Auto-created on first order. Loyalty signal only — no points engine yet.</p>
        </div>
      </div>

      {!error && customers.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="relative overflow-hidden shadow-lg ring-1 ring-primary/10 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-transparent">
            <CardContent className="flex items-center justify-between bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent pt-6">
              <div>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lifetime revenue</div>
                <div className="mt-1.5 font-heading text-3xl font-bold tabular-nums text-primary">
                  {formatPkr(customers.reduce((a, c) => a + c.totalSpendPaisa, 0))}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">across {customers.length} customer{customers.length === 1 ? "" : "s"}</div>
              </div>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-4 ring-primary/5">
                <CircleDollarSign className="size-4.5" />
              </span>
            </CardContent>
          </Card>
          <Card className="shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-heading text-base">
                <Trophy className="size-4 text-primary" />
                Top customers by spend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBarChart
                rows={[...customers]
                  .sort((a, b) => b.totalSpendPaisa - a.totalSpendPaisa)
                  .slice(0, 5)
                  .map((c) => ({ label: c.name ?? c.phone ?? "Unnamed", value: c.totalSpendPaisa }))}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 mb-4 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={inactiveOnly}
            className="pl-9"
          />
        </div>
        <Button
          variant={inactiveOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setInactiveOnly((v) => !v)}
        >
          {inactiveOnly ? "Showing inactive 30+ days" : "Show inactive 30+ days"}
        </Button>
      </div>

      <Card className="shadow-sm transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="font-heading">
            {loading ? "Customers" : `${customers.length} customer${customers.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Lock className="size-6 text-muted-foreground/50" />
              {error}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Total spend</TableHead>
                  <TableHead>Last order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Skeleton className="size-7 shrink-0 rounded-full" />
                          <Skeleton className="h-4 w-28" />
                        </div>
                      </TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    </TableRow>
                  ))}
                {!loading &&
                  customers.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setSelectedId(c.id);
                      }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {initials(c.name, c.phone)}
                          </span>
                          <span className="font-medium">{c.name ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.totalOrders}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatPkr(c.totalSpendPaisa)}</TableCell>
                      <TableCell>
                        {c.lastOrderAt ? (
                          <span className="text-muted-foreground">{new Date(c.lastOrderAt).toLocaleDateString()}</span>
                        ) : (
                          <Badge variant="secondary">Never ordered</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                {!loading && customers.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No customers found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CustomerDetailDialog customerId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function CustomerDetailDialog({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    (async () => {
      setDetail(null);
      setError(null);
      try {
        const r = await fetch(`/api/customers/${customerId}`);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(body.error ?? "Could not load this customer.");
          return;
        }
        setDetail(body);
      } catch {
        setError("Could not load this customer.");
      }
    })();
  }, [customerId]);

  return (
    <Dialog open={!!customerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 font-heading">
            {detail && (
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(detail.customer.name, detail.customer.phone)}
              </span>
            )}
            {detail?.customer.name ?? detail?.customer.phone ?? "Customer"}
          </DialogTitle>
        </DialogHeader>
        {error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Lock className="size-6 text-muted-foreground/50" />
            {error}
          </div>
        )}
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Phone</div>
                <div className="mt-0.5 font-semibold">{detail.customer.phone ?? "—"}</div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Total orders</div>
                <div className="mt-0.5 font-semibold tabular-nums">{detail.totalOrders}</div>
              </div>
              <div className="rounded-xl border bg-primary/10 p-3">
                <div className="text-xs text-muted-foreground">Total spend</div>
                <div className="mt-0.5 font-semibold tabular-nums text-primary">{formatPkr(detail.totalSpendPaisa)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <Label htmlFor="opt-out" className="flex items-center gap-2">
                <UserRound className="size-4 text-muted-foreground" />
                Opted out of WhatsApp messages
              </Label>
              <Switch
                id="opt-out"
                checked={detail.customer.whatsappOptOut}
                onCheckedChange={async (v: boolean) => {
                  const res = await fetch(`/api/customers/${detail.customer.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ whatsappOptOut: v }),
                  });
                  if (!res.ok) {
                    toast.error("Could not update.");
                    return;
                  }
                  setDetail((d) => (d ? { ...d, customer: { ...d.customer, whatsappOptOut: v } } : d));
                }}
              />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="tabular-nums">#{o.orderNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{o.branch.name}</TableCell>
                    <TableCell className="capitalize">{o.type.toLowerCase().replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Badge variant={ORDER_STATUS_VARIANT[o.status] ?? "secondary"} className="capitalize">
                        {o.status.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatPkr(o.totalPaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
