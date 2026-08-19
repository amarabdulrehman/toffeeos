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
import { toast } from "sonner";
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

export default function CustomersPage() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    const url = inactiveOnly ? "/api/customers/inactive?days=30" : `/api/customers?q=${encodeURIComponent(query)}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []));
  }, [query, inactiveOnly]);

  useEffect(load, [load]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Customers</h1>
      <p className="mb-4 text-muted-foreground">Auto-created on first order. Loyalty signal only — no points engine yet.</p>

      <div className="mb-4 flex items-center gap-3">
        <Input
          placeholder="Search by name or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={inactiveOnly}
          className="max-w-xs"
        />
        <Button
          variant={inactiveOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setInactiveOnly((v) => !v)}
        >
          {inactiveOnly ? "Showing inactive 30+ days" : "Show inactive 30+ days"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{customers.length} customer{customers.length === 1 ? "" : "s"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Total spend</TableHead>
                <TableHead>Last order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
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
                  <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell>{c.totalOrders}</TableCell>
                  <TableCell>{formatPkr(c.totalSpendPaisa)}</TableCell>
                  <TableCell>
                    {c.lastOrderAt ? (
                      new Date(c.lastOrderAt).toLocaleDateString()
                    ) : (
                      <Badge variant="secondary">Never ordered</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CustomerDetailDialog customerId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function CustomerDetailDialog({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);

  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/customers/${customerId}`)
      .then((r) => r.json())
      .then(setDetail);
  }, [customerId]);

  return (
    <Dialog open={!!customerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{detail?.customer.name ?? detail?.customer.phone ?? "Customer"}</DialogTitle>
        </DialogHeader>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Phone</div>
                <div className="font-medium">{detail.customer.phone ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total orders</div>
                <div className="font-medium">{detail.totalOrders}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total spend</div>
                <div className="font-medium">{formatPkr(detail.totalSpendPaisa)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="opt-out">Opted out of WhatsApp messages</Label>
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
                    <TableCell>#{o.orderNumber}</TableCell>
                    <TableCell>{o.branch.name}</TableCell>
                    <TableCell className="capitalize">{o.type.toLowerCase().replace("_", " ")}</TableCell>
                    <TableCell>
                      <Badge variant={o.status === "PAID" ? "secondary" : "outline"}>{o.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatPkr(o.totalPaisa)}</TableCell>
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
