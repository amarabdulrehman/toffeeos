"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPkr } from "@/lib/money";

interface RiderOrder {
  id: string;
  orderNumber: number;
  totalPaisa: number;
  pickedUpAt: string | null;
  lines: { id: string; nameSnapshot: string; quantity: number }[];
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

  if (loading) return <p className="text-center text-muted-foreground">Loading your deliveries…</p>;
  if (orders.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
        <Truck className="size-10 opacity-40" />
        <p>No deliveries assigned to you right now.</p>
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
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">#{order.orderNumber}</span>
        <span className="font-semibold">{formatPkr(order.totalPaisa)}</span>
      </div>
      {order.customer?.name && <div className="text-sm text-muted-foreground">{order.customer.name}</div>}
      <div className="mt-2 space-y-0.5 text-sm">
        {order.lines.map((l) => (
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
          <Button size="lg" disabled={submitting} onClick={() => fileInputRef.current?.click()}>
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
            className="flex-1"
          />
          <Button disabled={submitting} onClick={handleOtpSubmit}>
            Confirm
          </Button>
        </div>
      )}
    </div>
  );
}
