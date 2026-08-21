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
import type { FloorDto, OrderDto, RestaurantTableDto } from "./types";

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

  const load = () => {
    fetch("/api/tables")
      .then((r) => r.json())
      .then((d) => setFloors(d.floors ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    if (open) load();
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
                    disabled={loadingTableId === table.id}
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

/** Compact summary shown after resuming an occupied table — Phase 2 intentionally does not
 * support adding items to an already-punched order here (kitchen may already be cooking it;
 * that's a bigger "edit a live order" feature for later), so this offers the actions that make
 * sense today: view what's on it, and take payment. */
export function ResumedOrderPanel({
  table,
  order,
  onClose,
  onTakePayment,
}: {
  table: RestaurantTableDto;
  order: OrderDto;
  onClose: () => void;
  onTakePayment: () => void;
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
        <Button variant="success" size="lg" className="w-full" onClick={onTakePayment}>
          Take Payment
        </Button>
      )}
    </div>
  );
}
