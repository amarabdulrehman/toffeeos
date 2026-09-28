"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import type { PaymentMethod } from "./types";

interface PreviewTotals {
  totalPaisa: number;
  taxPaisa: number;
  tenders: { method: PaymentMethod; rateBasisPoints: number }[];
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "JAZZCASH", label: "JazzCash" },
  { value: "EASYPAISA", label: "Easypaisa" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
];

interface Tender {
  method: PaymentMethod;
  amountRs: string;
}

export function PaymentDialog({
  open,
  orderId,
  totalPaisa,
  onClose,
  onConfirm,
  submitting,
  offline = false,
}: {
  open: boolean;
  /** Null while the dialog is closed/unmounting — the live preview fetch below is skipped then. */
  orderId: string | null;
  totalPaisa: number;
  onClose: () => void;
  onConfirm: (tenders: { method: PaymentMethod; amountPaisa: number }[]) => void;
  submitting: boolean;
  /**
   * The device has no connection. The total can only be repriced for a method's own tax rate by
   * the server (pay-preview below), so offline it stays at the order's stored total, which assumes
   * cash. A card taken at that figure was charged more than its bill: a Rs 284 card-rate bill
   * went through as Rs 305, and the server accepts it because it only refuses payments that fall
   * short. So offline, only cash is taken.
   */
  offline?: boolean;
}) {
  // Defaulting the cash tender to the full amount only works if this component remounts for
  // every new order — the caller passes key={order.id} on <PaymentDialog> for exactly that
  // reason, so this initializer runs fresh each time instead of only on the very first render.
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountRs: (totalPaisa / 100).toFixed(2) }]);
  const [cashGiven, setCashGiven] = useState("");
  // The order's persisted totalPaisa was computed at order-creation time assuming a CASH tender
  // (Punjab PRA's higher 16% rate) — it's only a placeholder until this resolves. Cash and card
  // are genuinely different totals (16% vs 8%), so "Amount due" must reflect whatever the cashier
  // currently has selected, not the number the order happened to be created with.
  const [preview, setPreview] = useState<PreviewTotals | null>(null);

  useEffect(() => {
    if (!orderId) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/orders/${orderId}/pay-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          tenders: tenders
            .map((t) => ({ method: t.method, amountPaisa: Math.round((parseFloat(t.amountRs) || 0) * 100) }))
            .filter((t) => t.amountPaisa > 0),
        }),
      })
        .then((r) => r.json())
        .then((d) => d.totals && setPreview(d.totals))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // tenders is a plain array of primitives per entry — stringify so the effect only re-runs
    // when a method or amount actually changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, JSON.stringify(tenders)]);

  const dueTotalPaisa = preview?.totalPaisa ?? totalPaisa;

  // Single-tender amount must always track the live due total, not just the "Amount due" banner —
  // switching CASH -> CARD changes the applicable tax rate (Punjab PRA: 16% vs 8%), which changes
  // dueTotalPaisa, but the tender's amountRs was only ever set once at mount from the order's
  // original (cash-assumed) total. Reproduced live: switching a Rs 290 cash bill to card silently
  // left amountRs at "290.00" while the true card total was Rs 270 — "Fully covered" showed true
  // (over-tendered, same as a cash overpayment) and Confirm charged the customer Rs 20 too much.
  // There's no legitimate reason for a single (unsplit) tender to differ from the amount due — the
  // "remaining" gate below never allows a single tender to be a genuine partial payment, that's
  // what adding a second (split) tender is for — so derive it at render time instead of syncing
  // `tenders` state via an effect (which would cascade renders and fight the split-payment case).
  // Multi-tender (split) amounts are left exactly as entered; only their sum is checked below.
  const effectiveTenders: Tender[] =
    tenders.length === 1 ? [{ ...tenders[0], amountRs: (dueTotalPaisa / 100).toFixed(2) }] : tenders;

  const tenderedPaisa = effectiveTenders.reduce((a, t) => a + Math.round((parseFloat(t.amountRs) || 0) * 100), 0);
  const remainingPaisa = dueTotalPaisa - tenderedPaisa;
  const offlineNonCash = offline && effectiveTenders.some((t) => t.method !== "CASH");
  const changePaisa = Math.max(0, Math.round((parseFloat(cashGiven) || 0) * 100) - dueTotalPaisa);

  function updateTender(i: number, patch: Partial<Tender>) {
    setTenders((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  function addTender() {
    setTenders((prev) => [...prev, { method: "CARD", amountRs: (Math.max(0, remainingPaisa) / 100).toFixed(2) }]);
  }

  function removeTender(i: number) {
    setTenders((prev) => prev.filter((_, idx) => idx !== i));
  }

  function confirm() {
    onConfirm(
      effectiveTenders
        .map((t) => ({ method: t.method, amountPaisa: Math.round((parseFloat(t.amountRs) || 0) * 100) }))
        .filter((t) => t.amountPaisa > 0)
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Take payment</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-primary/10 px-4 py-3.5 text-center shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Amount due</div>
          <div className="font-heading text-3xl font-bold tabular-nums text-primary">{formatPkr(dueTotalPaisa)}</div>
          {preview && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              incl. {formatPkr(preview.taxPaisa)} tax
              {preview.tenders.length === 1 && ` (${(preview.tenders[0].rateBasisPoints / 100).toFixed(0)}%)`}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {effectiveTenders.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={t.method} onValueChange={(v) => v && updateTender(i, { method: v as PaymentMethod })}>
                <SelectTrigger className="w-40">
                  {/* Select.Value shows the raw value ("BANK_TRANSFER") without a render function —
                   * it never reads a SelectItem's children automatically. */}
                  <SelectValue>{(v: PaymentMethod) => METHODS.find((m) => m.value === v)?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                inputMode="decimal"
                value={t.amountRs}
                onChange={(e) => updateTender(i, { amountRs: e.target.value })}
                // A single (unsplit) tender always equals the live amount due (see effectiveTenders
                // above) — editing it here would just be reverted on the next render, so disable it
                // instead of leaving a text box that silently refuses to keep what was typed. Split
                // amounts (2+ tenders) stay freely editable, same as before.
                disabled={effectiveTenders.length === 1}
                className="flex-1 text-right font-medium tabular-nums"
              />
              {tenders.length > 1 && (
                <button
                  onClick={() => removeTender(i)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addTender}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="size-3.5" />
            Split payment
          </button>

          {tenders.some((t) => t.method === "CASH") && (
            <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Cash given:</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={cashGiven}
                  onChange={(e) => setCashGiven(e.target.value)}
                  className="h-8 w-24 tabular-nums"
                />
              </div>
              <div>
                Change: <span className="font-heading font-semibold text-success">{formatPkr(changePaisa)}</span>
              </div>
            </div>
          )}

          {offlineNonCash && (
            <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
              You&apos;re offline, so only cash can be taken. Card and other methods are charged at their own tax
              rate, which needs the connection. Take cash, or wait until you&apos;re back online.
            </p>
          )}

          <div
            className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold ${
              remainingPaisa > 0
                ? "bg-destructive/10 text-destructive"
                : "bg-success/15 text-success"
            }`}
          >
            {remainingPaisa > 0 ? `${formatPkr(remainingPaisa)} remaining` : "Fully covered"}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" size="lg" onClick={confirm} disabled={remainingPaisa > 0 || submitting || offlineNonCash}>
            {submitting ? "Processing…" : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
