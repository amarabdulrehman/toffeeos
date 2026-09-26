"use client";

import { useState, type ReactNode } from "react";
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

/** Items still on the order — a voided one is kept for the record but is no longer on the bill. */
function liveCount(o: OrderDto): number {
  return o.lines.filter((l) => !l.isVoided).length;
}

export function OrderQueuePanel({
  approvals,
  awaitingApprovalIds,
  orders,
  earlierUnpaid = [],
  onPay,
  onVoid,
  canVoid,
  onCancel,
  canCancel,
  onReprintReceipt,
  onReprintKot,
  onPrintBill,
  onManage,
  canRefund,
  onRefund,
  onClose,
}: {
  /** Waiter orders waiting for the counter, above the queue — see ApprovalsSection. */
  approvals?: ReactNode;
  /** Orders with something waiting for approval: not payable until it is decided (the server
   * refuses anyway), so they say so rather than offering Payment. */
  awaitingApprovalIds?: ReadonlySet<string>;
  /** Today's orders — this business day's, paid and unpaid. */
  orders: OrderDto[];
  /** An earlier day's orders still unpaid: listed apart, folded away, so they can't be lost. */
  earlierUnpaid?: OrderDto[];
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
  /** Omit to hide it — gated by pos.kot.reprint. Separate from printing one at the moment the
   * order is sent, because a reprint usually means the first slip was lost or never came out, and
   * a kitchen that can silently reprint tickets can also quietly duplicate an order. */
  onReprintKot?: (order: OrderDto) => void;
  /** Omit to hide it — gated by pos.receipt.print. The bill a table asks for before paying. */
  onPrintBill?: (order: OrderDto) => void;
  /** Omit to hide it — shown when the role allows any of voiding an item, changing type, merging
   * tables or tax exemption. */
  onManage?: (order: OrderDto) => void;
  /** pos.payment.refund. Absent for a cashier whose role does not grant it. */
  canRefund?: boolean;
  onRefund?: (order: OrderDto) => void;
  onClose: () => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);

  const row = (o: OrderDto) => (
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
          {liveCount(o)} item{liveCount(o) !== 1 ? "s" : ""}
          {o.taxExemptReason && <span className="ml-1.5 text-warning-foreground">· tax exempt</span>}
        </span>
        <span className="font-heading text-sm font-semibold tabular-nums">{formatPkr(o.totalPaisa)}</span>
      </div>
      {o.status !== "PAID" && o.status !== "VOIDED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {awaitingApprovalIds?.has(o.id) ? (
            <span className="flex flex-1 items-center justify-center rounded-md border border-warning/60 bg-warning/10 px-3 text-sm font-medium text-warning-foreground">
              Waiting for approval
            </span>
          ) : (
            <Button variant="success" className="flex-1" onClick={() => onPay(o)}>
              Payment
            </Button>
          )}
          {/* Only once it has actually gone to the kitchen — a ticket for an order the
              kitchen has not been told about is how the same food gets made twice. */}
          {onPrintBill && (
            <Button variant="outline" onClick={() => onPrintBill(o)}>
              Bill
            </Button>
          )}
          {onManage && (
            <Button variant="outline" onClick={() => onManage(o)}>
              Manage
            </Button>
          )}
          {onReprintKot && o.status !== "OPEN" && (
            <Button variant="outline" onClick={() => onReprintKot(o)}>
              Ticket
            </Button>
          )}
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
  );

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
        {approvals}
        {orders.length === 0 && (
          <div className="mt-10 text-center text-sm text-muted-foreground">No orders yet today.</div>
        )}
        {orders.map(row)}
        {/* An earlier day's unpaid order, kept apart rather than hidden: a table seated at 11:30pm is
            still eating at 12:15, and a bill nobody can find is a bill nobody collects. */}
        {earlierUnpaid.length > 0 && (
          <div className="rounded-xl border border-dashed p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm"
              aria-expanded={showEarlier}
              onClick={() => setShowEarlier((v) => !v)}
            >
              <span>
                <span className="font-medium">Earlier days</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {earlierUnpaid.length} not paid
                </span>
              </span>
              <span className="text-xs font-medium text-primary">{showEarlier ? "Hide" : "Show"}</span>
            </button>
            {showEarlier && <div className="mt-3 space-y-2.5">{earlierUnpaid.map(row)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
