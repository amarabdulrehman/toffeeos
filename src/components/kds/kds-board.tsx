"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  sentToKitchenAt: string | null;
  table: { label: string } | null;
  lines: KdsLine[];
}

const TYPE_STYLE: Record<KdsOrder["type"], string> = {
  DINE_IN: "border-t-4 border-t-blue-500",
  TAKEAWAY: "border-t-4 border-t-amber-500",
  DELIVERY: "border-t-4 border-t-purple-500",
  SERVICE: "border-t-4 border-t-emerald-500",
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
    <div className={`flex flex-col rounded-lg bg-slate-900 shadow ${TYPE_STYLE[order.type]}`}>
      <div className="flex items-center justify-between px-3 py-2">
        <div>
          <div className="font-bold">#{order.orderNumber}</div>
          <div className="text-xs text-slate-400">
            {order.type.replace("_", " ")}
            {order.table ? ` · ${order.table.label}` : ""}
          </div>
        </div>
        <div className={`rounded px-2 py-1 text-sm font-mono ${late ? "bg-red-600" : "bg-slate-700"}`}>
          {formatElapsed(elapsed)}
        </div>
      </div>
      <div className="flex-1 space-y-1 px-3 pb-2">
        {order.lines.map((line) => (
          <label key={line.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={line.kitchenReady} onCheckedChange={() => toggleLine(line.id)} />
            <span className={line.kitchenReady ? "text-slate-500 line-through" : ""}>
              {line.quantity}× {line.nameSnapshot}
            </span>
          </label>
        ))}
      </div>
      {canMarkReady && (
        <div className="flex gap-2 border-t border-slate-800 p-2">
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
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search order #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-40 border-slate-700 bg-slate-900 text-white"
        />
        <Badge
          variant={typeFilter === "ALL" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setTypeFilter("ALL")}
        >
          All
        </Badge>
        {groups.map((g) => (
          <Badge
            key={g.type}
            variant={typeFilter === g.type ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setTypeFilter(g.type)}
          >
            {g.label}
          </Badge>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="mt-20 text-center text-slate-500">No active kitchen orders.</div>
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
