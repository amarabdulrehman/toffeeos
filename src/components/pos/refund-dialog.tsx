"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import { itemRefundAmount } from "@/lib/item-refund";
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
  // "Items": pick what came back and the amount is worked out from them, exactly as the server will.
  const [mode, setMode] = useState<"amount" | "items">("amount");
  const [picked, setPicked] = useState<Record<string, number>>({});
  // Refunds are only ever taken online: the server checks what is left to give back. Without the
  // connection the earlier refunds can't be read, so the window says so instead of offering a
  // figure it can't stand behind. (Offline, this fetch used to throw unhandled and leave the
  // window blank; found by e2e/pos-resilience.spec.ts.)
  const [unreachable, setUnreachable] = useState(false);

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
        } else {
          setUnreachable(true);
        }
      } catch {
        setUnreachable(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, [order.id, paidPaisa]);

  // Only lines the till knows the price of (every synced order) can be refunded by item.
  const refundable = (order.lines ?? []).filter(
    (l) => !l.isVoided && !l.isComplimentary && l.unitPricePaisa != null && l.quantity - (l.refundedQuantity ?? 0) > 0
  );
  const pickedItems = Object.entries(picked)
    .filter(([, q]) => q > 0)
    .map(([lineId, quantity]) => ({ lineId, quantity }));
  const worked =
    mode === "items" && pickedItems.length > 0
      ? itemRefundAmount(
          { paidPaisa, refundedPaisa },
          (order.lines ?? [])
            .filter((l) => l.unitPricePaisa != null)
            .map((l) => ({
              id: l.id,
              nameSnapshot: l.nameSnapshot,
              unitPricePaisa: l.unitPricePaisa as number,
              quantity: l.quantity,
              isVoided: l.isVoided ?? false,
              isComplimentary: l.isComplimentary ?? false,
              refundedQuantity: l.refundedQuantity ?? 0,
              discountType: l.discountType ?? null,
              discountValue: l.discountValue ?? null,
            })),
          pickedItems
        )
      : null;

  async function submit() {
    if (mode === "items") {
      if (!worked || !worked.ok) {
        toast.error(worked && !worked.ok ? worked.error : "Pick the items to refund.");
        return;
      }
      if (!reason.trim()) {
        toast.error("Give a reason for the refund.");
        return;
      }
      await send({ items: pickedItems }, worked.amountPaisa);
      return;
    }
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

    await send({ amountPaisa: paisa }, paisa);
  }

  async function send(what: { amountPaisa: number } | { items: { lineId: string; quantity: number }[] }, paisa: number) {
    setSubmitting(true);
    let res: Response;
    try {
      res = await fetch(`/api/orders/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...what, method, reason: reason.trim() }),
      });
    } catch {
      toast.error("Couldn't reach the server, so no refund was recorded. Try again once you're back online.");
      return;
    } finally {
      setSubmitting(false);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not record that refund.");
      return;
    }
    toast.success(`Refunded ${formatPkr(body.refund?.amountPaisa ?? paisa)}`);
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

        {unreachable ? (
          <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
            The server can&apos;t be reached, so a refund can&apos;t be taken right now. Try again once you&apos;re back
            online.
          </p>
        ) : remainingPaisa === 0 && loaded ? (
          <p className="text-sm text-muted-foreground">This order has been fully refunded.</p>
        ) : (
          <>
            {refundable.length > 0 && (
              <div role="group" aria-label="Refund by" className="grid grid-cols-2 gap-2">
                <Button variant={mode === "amount" ? "default" : "outline"} aria-pressed={mode === "amount"} onClick={() => setMode("amount")}>
                  An amount
                </Button>
                <Button variant={mode === "items" ? "default" : "outline"} aria-pressed={mode === "items"} onClick={() => setMode("items")}>
                  Items
                </Button>
              </div>
            )}

            {mode === "items" && (
              <div className="space-y-1.5">
                <ul className="space-y-1.5">
                  {refundable.map((l) => {
                    const left = l.quantity - (l.refundedQuantity ?? 0);
                    const q = picked[l.id] ?? 0;
                    const set = (n: number) => setPicked((p) => ({ ...p, [l.id]: Math.max(0, Math.min(left, n)) }));
                    return (
                      <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="min-w-0">
                          {l.quantity}× {l.nameSnapshot}
                          {(l.refundedQuantity ?? 0) > 0 && (
                            <span className="ml-1.5 text-xs text-muted-foreground">({l.refundedQuantity} refunded)</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" aria-label={`One less ${l.nameSnapshot} to refund`} disabled={q === 0} onClick={() => set(q - 1)}>
                            −
                          </Button>
                          <span className="w-6 text-center tabular-nums">{q}</span>
                          <Button size="sm" variant="outline" aria-label={`One more ${l.nameSnapshot} to refund`} disabled={q === left} onClick={() => set(q + 1)}>
                            +
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-sm" data-testid="item-refund-amount">
                  {worked?.ok ? (
                    <>
                      Refund <span className="font-semibold tabular-nums">{formatPkr(worked.amountPaisa)}</span>
                      <span className="text-muted-foreground"> — their share of what was paid, tax included</span>
                    </>
                  ) : worked && !worked.ok ? (
                    <span className="text-destructive">{worked.error}</span>
                  ) : (
                    <span className="text-muted-foreground">Pick what came back.</span>
                  )}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mode === "amount" && (
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
              )}
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
          disabled={submitting || unreachable || remainingPaisa === 0 || !reason.trim()}
          onClick={submit}
        >
          Refund
        </Button>
      </DialogFooter>
    </>
  );
}
