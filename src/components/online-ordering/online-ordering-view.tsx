"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeletonRows } from "@/components/ui/table-skeleton";
import { formatPkr } from "@/lib/money";

interface Branding {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
}

interface OnlineOrder {
  id: string;
  orderNumber: number;
  status: string;
  totalPaisa: number;
  source: string;
}

// Same status vocabulary as the KDS board / POS order queue — an online order's status badge
// should read the same everywhere it shows up, not a flat "secondary" here specifically.
const STATUS_VARIANT: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
  OPEN: "secondary",
  SENT_TO_KITCHEN: "warning",
  READY: "default",
  SERVED: "default",
  PAID: "success",
  DELIVERED: "success",
  VOIDED: "destructive",
  CANCELLED: "destructive",
};

export function OnlineOrderingView() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/tenant-branding")
      .then((r) => r.json())
      .then((d: Branding) => {
        setBranding(d);
        setLogoUrl(d.logoUrl ?? "");
        setBrandColor(d.brandColor ?? "#7c3aed");
      });
    fetch("/api/orders")
      .then((r) => r.json())
      .then((d) => setOrders((d.orders ?? []).filter((o: OnlineOrder) => o.source === "ONLINE")))
      .finally(() => setOrdersLoading(false));
  }, []);

  useEffect(load, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/tenant-branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: logoUrl.trim() || null, brandColor: brandColor.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Could not save branding.");
        return;
      }
      toast.success("Branding saved.");
      load();
    } finally {
      setSaving(false);
    }
  }

  if (!branding) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/order/${branding.slug}` : `/order/${branding.slug}`;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Globe className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Online Ordering</h1>
          <p className="text-sm text-muted-foreground">
            A public ordering page — no online payment, customers pay at pickup or on delivery like a phone-in
            order.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Your ordering link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input readOnly value={publicUrl} className="font-mono text-sm" />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast.success("Copied.");
              }}
            >
              Copy
            </Button>
            <Button variant="outline" render={<a href={publicUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
              Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Logo URL</Label>
            <Input placeholder="https://..." value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Brand color</Label>
            <div className="flex items-center gap-2">
              <Input type="color" className="h-9 w-16 p-1" value={brandColor || "#7c3aed"} onChange={(e) => setBrandColor(e.target.value)} />
              <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-32 font-mono" />
            </div>
          </div>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save branding"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-sm transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle>Recent online orders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersLoading && <TableSkeletonRows widths={["w-12", "w-20", "w-16"]} align={["left", "left", "right"]} rows={4} />}
              {!ordersLoading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No online orders yet.
                  </TableCell>
                </TableRow>
              )}
              {!ordersLoading && orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>#{o.orderNumber}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[o.status] ?? "secondary"} className="capitalize">
                      {o.status.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{formatPkr(o.totalPaisa)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
