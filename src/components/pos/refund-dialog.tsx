"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import type { OrderDto, PaymentMethod } from "./types";

/**
 * Giving money back at the till.
 *
 * Opens on the full remaining amount, because a whole-order refund is the common case and typing
 * the figure again is how you fat-finger it. A reason is required rather than optional: it is the
 * question an owner asks a week later, and a refund with no reason is the obvious cover for
 * pocketing the difference.
 */

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "JAZZCASH", label: "JazzCash" },
  { value: "EASYPAISA", label: "Easypaisa" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

interface RefundRow {
  id: string;
  amountPaisa: number;
  method: string;
  reason: string;
  refundedByName: string | null;
}

export function RefundDialog({
  order,
  onClose,
  onRefunded,
}: {
  order: OrderDto | null;
  onClose: () => void;
  onRefunded: () => void;
}) {
  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Refund — order #{order?.orderNumber}</DialogTitle>
        </DialogHeader>
        {order && <RefundBody key={order.id} order={order} onClose={onClose} onRefunded={onRefunded} />}
      </DialogContent>
    </Dialog>
  );
}

function RefundBody({
  order,
  onClose,
  onRefunded,
}: {
  order: OrderDto;
  onClose: () => void;
  onRefunded: () => void;
}) {
  const paidPaisa = order.paidPaisa ?? 0;
  const [already, setAlready] = useState<RefundRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(order.payments?.[0]?.method ?? "CASH");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refundedPaisa = already.reduce((sum, r) => sum + r.amountPaisa, 0);
  const remainingPaisa = Math.max(0, paidPaisa - refundedPaisa);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/refund`);
        if (res.ok) {
          const rows: RefundRow[] = (await res.json()).refunds ?? [];
          setAlready(rows);
          // Default to whatever is left, which is the whole amount on a first refund.
          const left = paidPaisa - rows.reduce((sum, r) => sum + r.amountPaisa, 0);
          setAmount(left > 0 ? String(left / 100) : "");
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, [order.id, paidPaisa]);

  async function submit() {
    const paisa = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paisa) || paisa <= 0) {
      toast.error("Enter an amount to refund.");
      return;
    }
    if (paisa > remainingPaisa) {
      toast.error(`At most ${formatPkr(remainingPaisa)} is left to refund.`);
      return;
    }
    if (!reason.trim()) {
      toast.error("Give a reason for the refund.");
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/orders/${order.id}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPaisa: paisa, method, reason: reason.trim() }),
    });
    setSubmitting(false);

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not record that refund.");
      return;
    }
    toast.success(`Refunded ${formatPkr(paisa)}`);
    onRefunded();
    onClose();
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Paid</div>
            <div className="font-heading font-semibold tabular-nums">{formatPkr(paidPaisa)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Left to refund</div>
            <div className="font-heading font-semibold tabular-nums">{formatPkr(remainingPaisa)}</div>
          </div>
        </div>

        {already.length > 0 && (
          <div className="space-y-1.5">
            <Label>Already refunded</Label>
            {already.map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="tabular-nums font-medium">{formatPkr(r.amountPaisa)}</span>
                  <span className="text-muted-foreground"> · {r.reason}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{r.refundedByName ?? ""}</span>
              </div>
            ))}
          </div>
        )}

        {remainingPaisa === 0 && loaded ? (
          <p className="text-sm text-muted-foreground">This order has been fully refunded.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">Amount (Rs)</Label>
                <Input
                  id="refund-amount"
                  type="number"
                  min={0}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Given back as</Label>
                <Select value={method} onValueChange={(v) => v && setMethod(v as PaymentMethod)}>
                  <SelectTrigger className="w-full" aria-label="Refund method">
                    <SelectValue>
                      {(v: string) => METHODS.find((m) => m.value === v)?.label ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="refund-reason">Reason</Label>
              <Input
                id="refund-reason"
                placeholder="e.g. dish returned, charged twice"
                maxLength={280}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Recorded against the order and in the audit log. Cash refunds come out of today&apos;s drawer.
              </p>
            </div>
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={submitting || remainingPaisa === 0 || !reason.trim()}
          onClick={submit}
        >
          Refund
        </Button>
      </DialogFooter>
    </>
  );
}
