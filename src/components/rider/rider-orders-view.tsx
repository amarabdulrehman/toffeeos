"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, MapPin, PackageCheck, Phone, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPkr } from "@/lib/money";

interface RiderOrder {
  id: string;
  orderNumber: number;
  totalPaisa: number;
  pickedUpAt: string | null;
  deliveryAddress: string | null;
  lines: { id: string; nameSnapshot: string; quantity: number; isVoided?: boolean }[];
  customer: { name: string | null; phone: string | null } | null;
}

export function RiderOrdersView() {
  const [orders, setOrders] = useState<RiderOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/rider/orders")
      .then((r) => r.json())
      .then((d) => setOrders(d.orders ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return <p className="mt-16 text-center text-sm text-muted-foreground">Loading your deliveries…</p>;
  if (orders.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Truck className="size-6" />
        </span>
        <p className="text-sm text-muted-foreground">No deliveries assigned to you right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} onChanged={load} />
      ))}
    </div>
  );
}

async function markPickedUp(orderId: string) {
  const res = await fetch(`/api/rider/orders/${orderId}/picked-up`, { method: "POST" });
  return res.ok;
}

function OrderCard({ order, onChanged }: { order: RiderOrder; onChanged: () => void }) {
  const [mode, setMode] = useState<"idle" | "photo" | "otp">("idle");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePickedUp() {
    setSubmitting(true);
    try {
      const ok = await markPickedUp(order.id);
      if (!ok) {
        toast.error("Could not mark picked up.");
        return;
      }
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePhotoSelected(file: File) {
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`/api/rider/orders/${order.id}/deliver`, { method: "POST", body: form });
      if (!res.ok) {
        toast.error("Could not confirm delivery.");
        return;
      }
      toast.success(`Order #${order.orderNumber} delivered.`);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpSubmit() {
    if (!code.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/rider/orders/${order.id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Incorrect code.");
        return;
      }
      toast.success(`Order #${order.orderNumber} delivered.`);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`rounded-2xl border-l-4 bg-card p-4 shadow-sm ${order.pickedUpAt ? "border-l-info" : "border-l-warning"}`}>
      <div className="flex items-center justify-between">
        <span className="font-heading text-xl font-bold tabular-nums">#{order.orderNumber}</span>
        <Badge variant={order.pickedUpAt ? "info" : "warning"}>{order.pickedUpAt ? "Out for delivery" : "Ready for pickup"}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between">
        {order.customer?.name ? (
          <span className="text-sm font-medium text-muted-foreground">{order.customer.name}</span>
        ) : (
          <span />
        )}
        <span className="font-heading text-base font-semibold tabular-nums">{formatPkr(order.totalPaisa)}</span>
      </div>
      {order.customer?.phone && (
        <a
          href={`tel:${order.customer.phone}`}
          className="mt-2 flex w-fit items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-sm font-semibold text-success"
        >
          <Phone className="size-3.5" />
          {order.customer.phone}
        </a>
      )}
      {order.deliveryAddress && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 text-sm font-medium">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {order.deliveryAddress}
        </div>
      )}
      <div className="mt-2.5 space-y-0.5 text-sm text-muted-foreground">
        {order.lines.filter((l) => !l.isVoided).map((l) => (
          <div key={l.id}>
            {l.quantity}× {l.nameSnapshot}
          </div>
        ))}
      </div>

      {!order.pickedUpAt ? (
        <Button size="lg" className="mt-4 w-full" disabled={submitting} onClick={handlePickedUp}>
          <PackageCheck className="size-4" />
          Mark Picked Up
        </Button>
      ) : mode === "idle" ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button size="lg" variant="success" disabled={submitting} onClick={() => fileInputRef.current?.click()}>
            <Camera className="size-4" />
            Photo
          </Button>
          <Button size="lg" variant="outline" disabled={submitting} onClick={() => setMode("otp")}>
            Enter code
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePhotoSelected(file);
            }}
          />
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <Input
            inputMode="numeric"
            placeholder="4-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-11 flex-1 text-center text-lg tracking-[0.3em]"
          />
          <Button size="lg" variant="success" disabled={submitting} onClick={handleOtpSubmit}>
            Confirm
          </Button>
        </div>
      )}
    </div>
  );
}
