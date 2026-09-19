"use client";

import { Printer, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPkr } from "@/lib/money";
import type { OrderDto } from "./types";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "info" | "success"> = {
  OPEN: "secondary",
  SENT_TO_KITCHEN: "info",
  READY: "success",
  SERVED: "outline",
  PAID: "secondary",
};

export function OrderQueuePanel({
  orders,
  onPay,
  onVoid,
  canVoid,
  onCancel,
  canCancel,
  onReprintReceipt,
  canRefund,
  onRefund,
  onClose,
}: {
  orders: OrderDto[];
  onPay: (order: OrderDto) => void;
  onVoid?: (order: OrderDto) => void;
  canVoid?: boolean;
  /** Cancelling an order already sent to the kitchen — a separate action from Void (mandatory
   * reason, creates a reviewable record a manager/owner sees) gated by orders.cancel, not
   * pos.order.void. Shown instead of Void once the order has left OPEN, so there's only ever one
   * "back out of this order" button per state. */
  onCancel?: (order: OrderDto) => void;
  canCancel?: boolean;
  /** Omit to hide the action entirely — gated by pos.receipt.reprint, separate from the
   * take-payment permission, since re-printing an already-paid order's receipt is its own
   * auditable action, not just a side effect of paying. */
  onReprintReceipt?: (order: OrderDto) => void;
  /** pos.payment.refund. Absent for a cashier whose role does not grant it. */
  canRefund?: boolean;
  onRefund?: (order: OrderDto) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-heading text-base font-semibold">Order Queue</h2>
        <button
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {orders.length === 0 && <div className="mt-10 text-center text-sm text-muted-foreground">No open orders.</div>}
        {orders.map((o) => (
          <div key={o.id} className="rounded-xl border border-border/60 bg-background p-4 shadow-xs transition-colors hover:border-primary/30 hover:shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-heading text-sm font-semibold">
                #{o.orderNumber} · {o.type.replace("_", " ")}
                {o.source && o.source !== "POS" && (
                  <Badge variant="outline" className="text-2xs font-medium">
                    {o.source}
                  </Badge>
                )}
              </div>
              <Badge variant={STATUS_VARIANT[o.status] ?? "secondary"}>{o.status.replace(/_/g, " ")}</Badge>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">
                {o.lines.length} item{o.lines.length !== 1 ? "s" : ""}
              </span>
              <span className="font-heading text-sm font-semibold tabular-nums">{formatPkr(o.totalPaisa)}</span>
            </div>
            {o.status !== "PAID" && o.status !== "VOIDED" && (
              <div className="mt-3 flex gap-2">
                <Button variant="success" className="flex-1" onClick={() => onPay(o)}>
                  Payment
                </Button>
                {o.status === "SENT_TO_KITCHEN" || o.status === "READY" ? (
                  canCancel &&
                  onCancel && (
                    <Button variant="outline" className="text-destructive" onClick={() => onCancel(o)}>
                      Cancel
                    </Button>
                  )
                ) : (
                  canVoid &&
                  onVoid && (
                    <Button variant="outline" className="text-destructive" onClick={() => onVoid(o)}>
                      Void
                    </Button>
                  )
                )}
              </div>
            )}
            {o.status === "PAID" && (
              <div className="mt-3 flex gap-2">
                {onReprintReceipt && (
                  <Button variant="outline" className="flex-1" onClick={() => onReprintReceipt(o)}>
                    <Printer className="size-4" />
                    Reprint receipt
                  </Button>
                )}
                {/* Only shown to staff whose role grants it. Paid is the only status a refund makes
                    sense on: an unpaid order is corrected by voiding, which is different money. */}
                {canRefund && onRefund && (
                  <Button variant="outline" className="text-destructive" onClick={() => onRefund(o)}>
                    Refund
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
