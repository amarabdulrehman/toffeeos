"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useChannel } from "@/lib/realtime-client";
import { topic } from "@/lib/realtime-topics";
import { KotDialog } from "./kot-dialog";
import { formatElapsed } from "@/lib/elapsed";

const SLA_SECONDS = 600; // default KDS SLA; BranchSettings.kdsSlaSeconds makes this configurable server-side

interface KdsLine {
  id: string;
  nameSnapshot: string;
  quantity: number;
  kitchenReady: boolean;
  notes: string | null;
  /** Already sent by /api/kds/orders, which includes them deliberately — and was rendered nowhere,
   * so the screen showed "Latte" for a latte ordered with an extra shot. */
  modifiers?: { id: string; nameSnapshot: string }[];
}

interface KdsOrder {
  id: string;
  orderNumber: number;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
  status: string;
  source: "POS" | "ONLINE" | "QR";
  sentToKitchenAt: string | null;
  readyAt: string | null;
  table: { label: string } | null;
  lines: KdsLine[];
}

// Chip text uses the bright semantic color itself (not the *-foreground token) — these sit on a
// translucent tint over the dark KDS card, not a solid fill, so the pairing that keeps contrast
// high here is bright-color-on-dark-tint, same direction as the card background itself.
const TYPE_STYLE: Record<KdsOrder["type"], { border: string; chip: string }> = {
  DINE_IN: { border: "border-t-primary", chip: "bg-primary/20 text-primary" },
  TAKEAWAY: { border: "border-t-warning", chip: "bg-warning/25 text-warning" },
  DELIVERY: { border: "border-t-info", chip: "bg-info/25 text-info" },
  SERVICE: { border: "border-t-success", chip: "bg-success/25 text-success" },
};

// `until` freezes the clock at that timestamp (e.g. readyAt) instead of ticking against wall-clock
// `now` — without it, a KDS order stays visible after being marked ready (the board still shows
// READY orders until they're served) and its timer just kept counting up forever.
function useElapsedSeconds(since: string | null, until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!since) return 0;
  const end = until ? new Date(until).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(since).getTime()) / 1000));
}


function OrderCard({
  order,
  canMarkReady,
  onChanged,
  onPrint,
}: {
  order: KdsOrder;
  canMarkReady: boolean;
  onChanged: () => void;
  onPrint: (order: KdsOrder) => void;
}) {
  // Not order.status === "READY" — an order paid before the kitchen finishes stays at status
  // PAID (see the KDS route's doc comment), so readyAt is the only reliable "is this ready"
  // signal once payment and kitchen progress can diverge on the same status column.
  const isReady = order.readyAt !== null;
  const elapsed = useElapsedSeconds(order.sentToKitchenAt, isReady ? order.readyAt : null);
  // Once the kitchen has marked it ready, an old SLA breach is no longer something they need to
  // act on — that alarm belongs to whoever hasn't served/picked it up yet, not this board.
  const late = !isReady && elapsed > SLA_SECONDS;
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
    <div
      className={`flex flex-col rounded-2xl border-t-[6px] bg-card shadow-lg ${style.border} ${late ? "ring-2 ring-destructive/60" : ""}`}
    >
      <div className="flex items-center justify-between px-4 py-3.5">
        <div>
          <div className="font-heading text-2xl font-bold tabular-nums">#{order.orderNumber}</div>
          <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${style.chip}`}>
            {order.type.replace("_", " ")}
            {order.table ? ` · ${order.table.label}` : ""}
            {order.source !== "POS" ? ` · ${order.source}` : ""}
          </span>
        </div>
        <div
          className={`rounded-lg px-3 py-2 font-heading text-xl font-bold tabular-nums ${
            late
              ? "animate-pulse bg-destructive text-white"
              : isReady
                ? "bg-success/15 text-success"
                : "bg-muted text-foreground"
          }`}
        >
          {formatElapsed(elapsed)}
        </div>
      </div>
      <div className="flex-1 space-y-1 px-3 pb-3">
        {order.lines.map((line) => (
          <label
            key={line.id}
            className="flex items-start gap-3 rounded-lg px-1.5 py-2 text-base transition-colors hover:bg-muted/60"
          >
            <Checkbox
              checked={line.kitchenReady}
              onCheckedChange={() => toggleLine(line.id)}
              className="mt-0.5 size-6 rounded-[6px] [&_svg]:size-4.5"
            />
            <span className={`min-w-0 ${line.kitchenReady ? "text-muted-foreground/50 line-through" : ""}`}>
              <span className={line.kitchenReady ? "" : "font-semibold"}>
                {line.quantity}× {line.nameSnapshot}
              </span>
              {/* Indented under the item, in the order they affect what gets made: add-ons change
                  the dish, a note usually qualifies it. */}
              {line.modifiers?.map((m) => (
                <span key={m.id} className="block pl-1 text-sm text-warning">
                  + {m.nameSnapshot}
                </span>
              ))}
              {line.notes && <span className="block pl-1 text-sm italic opacity-80">— {line.notes}</span>}
            </span>
          </label>
        ))}
      </div>
      {canMarkReady && (
        <div className="flex gap-2 border-t border-border/60 p-3">
          <Button size="lg" variant="secondary" className="flex-1" onClick={() => onPrint(order)}>
            Print
          </Button>
          <Button size="lg" variant="success" className="flex-1" onClick={markOrderReady} disabled={isReady}>
            {isReady ? "Ready" : "Mark Ready"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Mirrors OrderCard's real shape (border-t accent, header row, a few line rows, action row) so
 * the board never renders an empty "No active kitchen orders" flash before the first fetch
 * actually resolves — the fixed count (8) roughly fills a typical viewport's grid without
 * over-fetching-shaped guessing at how many real cards will follow. */
function OrderCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border-t-[6px] border-t-muted bg-card shadow-lg">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-9 w-16 rounded-lg" />
      </div>
      <div className="space-y-2.5 px-3 pb-3">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <div className="flex gap-2 border-t border-border/60 p-3">
        <Skeleton className="h-11 flex-1 rounded-lg" />
        <Skeleton className="h-11 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export function KdsBoard({
  tenantId,
  branchId,
  branchName,
  canMarkReady,
}: {
  tenantId: string;
  branchId: string;
  branchName: string;
  canMarkReady: boolean;
}) {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<KdsOrder["type"] | "ALL">("ALL");
  const [printingOrder, setPrintingOrder] = useState<KdsOrder | null>(null);

  const load = useCallback(() => {
    fetch("/api/kds/orders")
      .then((r) => r.json())
      .then((d) => setOrders(d.orders ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
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
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-44 rounded-full bg-card pl-10"
          />
        </div>
        <div className="mx-1 h-7 w-px bg-border" />
        <button
          onClick={() => setTypeFilter("ALL")}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            typeFilter === "ALL" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.type}
            onClick={() => setTypeFilter(g.type)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
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
        {loading && orders.length === 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <OrderCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-20 text-center text-muted-foreground">No active kitchen orders.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((o) => (
              <OrderCard key={o.id} order={o} canMarkReady={canMarkReady} onChanged={load} onPrint={setPrintingOrder} />
            ))}
          </div>
        )}
      </div>

      <KotDialog order={printingOrder} branchName={branchName} onClose={() => setPrintingOrder(null)} />
    </div>
  );
}
