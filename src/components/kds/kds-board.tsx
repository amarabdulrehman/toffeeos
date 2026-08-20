"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useChannel } from "@/lib/realtime-client";
import { topic } from "@/lib/realtime-topics";

const SLA_SECONDS = 600; // default KDS SLA; BranchSettings.kdsSlaSeconds makes this configurable server-side

interface KdsLine {
  id: string;
  nameSnapshot: string;
  quantity: number;
  kitchenReady: boolean;
  notes: string | null;
}

interface KdsOrder {
  id: string;
  orderNumber: number;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
  status: string;
  source: "POS" | "ONLINE" | "QR";
  sentToKitchenAt: string | null;
  table: { label: string } | null;
  lines: KdsLine[];
}

const TYPE_STYLE: Record<KdsOrder["type"], { border: string; chip: string }> = {
  DINE_IN: { border: "border-t-primary", chip: "bg-primary/15 text-primary" },
  TAKEAWAY: { border: "border-t-warning", chip: "bg-warning/20 text-warning-foreground" },
  DELIVERY: { border: "border-t-sky-500", chip: "bg-sky-500/15 text-sky-400" },
  SERVICE: { border: "border-t-success", chip: "bg-success/15 text-success" },
};

function useElapsedSeconds(since: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!since) return 0;
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function OrderCard({ order, canMarkReady, onChanged }: { order: KdsOrder; canMarkReady: boolean; onChanged: () => void }) {
  const elapsed = useElapsedSeconds(order.sentToKitchenAt);
  const late = elapsed > SLA_SECONDS;
  const style = TYPE_STYLE[order.type];

  async function toggleLine(lineId: string) {
    const res = await fetch(`/api/order-lines/${lineId}/ready`, { method: "POST" });
    if (!res.ok) {
      toast.error("Could not update item.");
      return;
    }
    onChanged();
  }

  async function markOrderReady() {
    const res = await fetch(`/api/orders/${order.id}/ready`, { method: "POST" });
    if (!res.ok) {
      toast.error("Could not mark order ready.");
      return;
    }
    onChanged();
  }

  return (
    <div className={`flex flex-col rounded-2xl border-t-4 bg-card shadow-md ${style.border} ${late ? "ring-1 ring-destructive/40" : ""}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="font-heading text-lg font-bold tabular-nums">#{order.orderNumber}</div>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}>
            {order.type.replace("_", " ")}
            {order.table ? ` · ${order.table.label}` : ""}
            {order.source !== "POS" ? ` · ${order.source}` : ""}
          </span>
        </div>
        <div
          className={`rounded-lg px-2.5 py-1.5 font-heading text-lg font-bold tabular-nums ${
            late ? "animate-pulse bg-destructive text-white" : "bg-muted text-foreground"
          }`}
        >
          {formatElapsed(elapsed)}
        </div>
      </div>
      <div className="flex-1 space-y-1.5 px-4 pb-3">
        {order.lines.map((line) => (
          <label key={line.id} className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={line.kitchenReady} onCheckedChange={() => toggleLine(line.id)} />
            <span className={line.kitchenReady ? "text-muted-foreground/60 line-through" : "font-medium"}>
              {line.quantity}× {line.nameSnapshot}
            </span>
          </label>
        ))}
      </div>
      {canMarkReady && (
        <div className="flex gap-2 border-t p-2.5">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => window.print()}>
            Print
          </Button>
          <Button size="sm" className="flex-1" onClick={markOrderReady} disabled={order.status === "READY"}>
            {order.status === "READY" ? "Ready" : "Mark Ready"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function KdsBoard({
  tenantId,
  branchId,
  canMarkReady,
}: {
  tenantId: string;
  branchId: string;
  canMarkReady: boolean;
}) {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<KdsOrder["type"] | "ALL">("ALL");

  const load = useCallback(() => {
    fetch("/api/kds/orders")
      .then((r) => r.json())
      .then((d) => setOrders(d.orders ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  useChannel(topic(tenantId, branchId, "kds"), () => load());

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (typeFilter !== "ALL" && o.type !== typeFilter) return false;
      if (search && !String(o.orderNumber).includes(search)) return false;
      return true;
    });
  }, [orders, typeFilter, search]);

  const groups: { type: KdsOrder["type"]; label: string }[] = [
    { type: "DINE_IN", label: "Dine-in" },
    { type: "TAKEAWAY", label: "Takeaway" },
    { type: "DELIVERY", label: "Delivery" },
    { type: "SERVICE", label: "Service" },
  ];

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-44 rounded-full bg-card pl-9"
          />
        </div>
        <div className="mx-1 h-6 w-px bg-border" />
        <button
          onClick={() => setTypeFilter("ALL")}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            typeFilter === "ALL" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.type}
            onClick={() => setTypeFilter(g.type)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              typeFilter === g.type
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="mt-20 text-center text-muted-foreground">No active kitchen orders.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((o) => (
              <OrderCard key={o.id} order={o} canMarkReady={canMarkReady} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
