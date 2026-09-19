"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPkr } from "@/lib/money";
import { useChannel } from "@/lib/realtime-client";
import { topic } from "@/lib/realtime-topics";
import { cacheTables, getCachedTables } from "@/lib/offline/db";
import { CartRow } from "./cart-panel";
import type { CartLine, FloorDto, OrderDto, RestaurantTableDto } from "./types";

type StatusFilter = "ALL" | "AVAILABLE" | "RESERVED" | "BOOKED";

const STATUS_DOT: Record<RestaurantTableDto["status"], string> = {
  AVAILABLE: "bg-muted-foreground/30",
  RESERVED: "bg-sky-500",
  BOOKED: "bg-violet-500",
  OCCUPIED: "bg-warning",
};

const STATUS_RING: Record<RestaurantTableDto["status"], string> = {
  AVAILABLE: "border-border",
  RESERVED: "border-sky-500",
  BOOKED: "border-violet-500",
  OCCUPIED: "border-warning",
};

export function TablesDialog({
  open,
  tenantId,
  branchId,
  onClose,
  onStartOrder,
  onResumeOrder,
}: {
  open: boolean;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onStartOrder: (table: RestaurantTableDto) => void;
  onResumeOrder: (table: RestaurantTableDto, order: OrderDto) => void;
}) {
  const [floors, setFloors] = useState<FloorDto[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [loadingTableId, setLoadingTableId] = useState<string | null>(null);
  // `floors` deliberately isn't reset on close/reopen (avoids a flash of "no tables" while the
  // next fetch is in flight) — but that means a table button from the *previous* open can already
  // be rendered, visible, and tappable before this reopen's own fetch has actually resolved. A tap
  // in that window acts on stale status (e.g. "AVAILABLE" from before an order existed for it),
  // taking the wrong branch in handleTap below and silently starting a new order instead of
  // resuming one. `refreshing` disables every table button for exactly that window.
  const [refreshing, setRefreshing] = useState(false);

  // getCachedTables/cacheTables already existed in src/lib/offline/db.ts (mirroring the menu and
  // open-orders caches) but were never actually wired up here — this dialog's own live fetch had
  // no fallback at all, so a cashier who genuinely lost connectivity (not just the app's own
  // "you're offline" detection, but an actual dropped fetch) couldn't open this dialog for a new
  // table: `.catch(() => {})` swallowed the error and left `floors` at its initial `[]`, same
  // result as "there are no tables." Found by an E2E test using real network emulation instead of
  // faking navigator.onLine — the fake never actually blocked the fetch, so this gap never showed.
  const load = () => {
    setRefreshing(true);
    fetch("/api/tables")
      .then((r) => r.json())
      .then((d) => {
        const loaded = d.floors ?? [];
        setFloors(loaded);
        cacheTables(loaded);
      })
      .catch(async () => {
        const cached = await getCachedTables();
        if (cached) setFloors(cached);
      })
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    // The IIFE indirection isn't decorative — `load` calls setRefreshing synchronously as its
    // first statement, and react-hooks/set-state-in-effect flags that when it's a direct call in
    // the effect body. Same escape hatch src/lib/offline/use-sync.ts's own effect already uses.
    if (open) {
      (() => load())();
    }
  }, [open]);

  useChannel(topic(tenantId, branchId, "tables"), () => {
    if (open) load();
  });

  const filteredFloors = useMemo(() => {
    return floors
      .map((f) => ({
        ...f,
        tables: f.tables.filter((t) => {
          if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
          if (search && !t.label.toLowerCase().includes(search.toLowerCase())) return false;
          return true;
        }),
      }))
      .filter((f) => f.tables.length > 0);
  }, [floors, statusFilter, search]);

  async function handleTap(table: RestaurantTableDto) {
    if (table.status === "AVAILABLE") {
      onStartOrder(table);
      return;
    }
    setLoadingTableId(table.id);
    try {
      const res = await fetch(`/api/tables/${table.id}/active-order`);
      const data = await res.json();
      if (!res.ok || !data.order) {
        toast.error("Could not find an open order for this table.");
        return;
      }
      onResumeOrder(table, data.order);
    } finally {
      setLoadingTableId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tables</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search table…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-40 pl-9"
            />
          </div>
          {(["ALL", "AVAILABLE", "RESERVED", "BOOKED"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "ALL" ? "All" : s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          {filteredFloors.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No matching tables.</div>
          )}
          {filteredFloors.map((floor) => (
            <div key={floor.id}>
              <div className="mb-2 text-sm font-semibold text-muted-foreground">{floor.name}</div>
              <div className="flex flex-wrap gap-3">
                {floor.tables.map((table) => (
                  <button
                    key={table.id}
                    disabled={refreshing || loadingTableId === table.id}
                    onClick={() => handleTap(table)}
                    className={`flex size-20 flex-col items-center justify-center rounded-full border-2 bg-card text-center shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 ${STATUS_RING[table.status]}`}
                  >
                    <span className="flex items-center gap-1 text-sm font-bold">
                      <span className={`size-1.5 rounded-full ${STATUS_DOT[table.status]}`} />
                      {table.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{table.seats} seats</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Compact summary shown after resuming an occupied table — view what's on it, add another round
 * if the kitchen isn't done yet, or take payment. */
export function ResumedOrderPanel({
  table,
  order,
  onClose,
  onTakePayment,
  onAddItems,
}: {
  table: RestaurantTableDto;
  order: OrderDto;
  onClose: () => void;
  onTakePayment: () => void;
  onAddItems: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-heading font-semibold">
            Table {table.label} · Order #{order.orderNumber}
          </div>
          <div className="text-sm text-muted-foreground">{order.status.replace(/_/g, " ")}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>
      <div className="space-y-1 text-sm">
        {order.lines.map((l) => (
          <div key={l.id} className="flex justify-between">
            <span>
              {l.quantity}× {l.nameSnapshot}
            </span>
            <span className="tabular-nums">{formatPkr(l.lineTotalPaisa)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-3 font-heading font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatPkr(order.totalPaisa)}</span>
      </div>
      {order.status !== "PAID" && (
        <div className="space-y-2">
          <Button variant="outline" size="lg" className="w-full" onClick={onAddItems}>
            Add items
          </Button>
          <Button variant="success" size="lg" className="w-full" onClick={onTakePayment}>
            Take Payment
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shown instead of ResumedOrderPanel while building a second round for an order already sent to
 * the kitchen — tapping items on the product grid to the left adds to `lines` here exactly like a
 * new order would, but "Send" posts to POST /api/orders/[orderId]/lines (addLinesToOrder) instead
 * of creating a new order. Deliberately minimal compared to the full CartPanel: order type, table,
 * customer, and order-level discount are all already fixed on the order this is appending to, so
 * none of those pickers apply here — this is just "what am I adding," not "what am I starting." */
export function AddItemsPanel({
  orderNumber,
  lines,
  onQuantityChange,
  onRemoveLine,
  onNoteChange,
  onCancel,
  onSubmit,
  submitting,
}: {
  orderNumber: number;
  lines: CartLine[];
  onQuantityChange: (key: string, delta: number) => void;
  onRemoveLine: (key: string) => void;
  onNoteChange: (key: string, notes: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const subtotalPaisa = lines.reduce((a, l) => a + l.unitPricePaisa * l.quantity, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <div className="font-heading font-semibold">Adding to Order #{orderNumber}</div>
        <p className="text-xs text-muted-foreground">
          Tax and the combined total are recalculated once these are sent — this is just the new items.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {lines.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">Tap items on the left to add them.</p>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              // The same row as the main cart, so a note can be written on a course added to a
              // table that is already eating — which is exactly when one gets asked for.
              <CartRow
                key={line.key}
                line={line}
                onQuantityChange={onQuantityChange}
                onRemoveLine={onRemoveLine}
                onNoteChange={onNoteChange}
              />
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 border-t bg-muted/30 p-4">
        <div className="flex items-center justify-between text-sm font-medium">
          <span className="text-muted-foreground">New items subtotal</span>
          <span className="tabular-nums">{formatPkr(subtotalPaisa)}</span>
        </div>
        <Button variant="outline" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="w-full" size="lg" disabled={lines.length === 0 || submitting} onClick={onSubmit}>
          {submitting ? "Sending…" : "Send to Kitchen"}
        </Button>
      </div>
    </div>
  );
}
