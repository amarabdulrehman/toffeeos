"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPkr } from "@/lib/money";
import type { OrderDto } from "./types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  OPEN: "outline",
  SENT_TO_KITCHEN: "secondary",
  READY: "default",
  SERVED: "secondary",
  PAID: "outline",
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
    <div className="flex h-full flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="font-semibold">Order Queue</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {orders.length === 0 && <div className="text-center text-sm text-muted-foreground">No open orders.</div>}
        {orders.map((o) => (
          <div key={o.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">
                #{o.orderNumber} · {o.type.replace("_", " ")}
              </div>
              <Badge variant={STATUS_VARIANT[o.status] ?? "outline"}>{o.status.replace(/_/g, " ")}</Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {o.lines.length} item{o.lines.length !== 1 ? "s" : ""} · {formatPkr(o.totalPaisa)}
            </div>
            {o.status !== "PAID" && (
              <Button size="sm" className="mt-2 w-full" onClick={() => onPay(o)}>
                Payment
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
