"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPkr } from "@/lib/money";
import type { OrderDto } from "./types";

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-muted text-muted-foreground",
  SENT_TO_KITCHEN: "bg-warning/20 text-warning-foreground",
  READY: "bg-success/15 text-success",
  SERVED: "bg-accent text-accent-foreground",
  PAID: "bg-muted text-muted-foreground",
};

export function OrderQueuePanel({
  orders,
  onPay,
  onClose,
}: {
  orders: OrderDto[];
  onPay: (order: OrderDto) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-heading text-base font-semibold">Order Queue</h2>
        <button
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {orders.length === 0 && <div className="mt-10 text-center text-sm text-muted-foreground">No open orders.</div>}
        {orders.map((o) => (
          <div key={o.id} className="rounded-xl border border-border/60 bg-background p-3.5 transition-colors hover:border-border">
            <div className="flex items-center justify-between">
              <div className="font-heading text-sm font-semibold">
                #{o.orderNumber} · {o.type.replace("_", " ")}
              </div>
              <Badge className={`${STATUS_STYLE[o.status] ?? "bg-muted text-muted-foreground"} border-none`}>
                {o.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">
                {o.lines.length} item{o.lines.length !== 1 ? "s" : ""}
              </span>
              <span className="font-heading text-sm font-semibold tabular-nums">{formatPkr(o.totalPaisa)}</span>
            </div>
            {o.status !== "PAID" && (
              <Button size="sm" className="mt-2.5 w-full" onClick={() => onPay(o)}>
                Payment
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
