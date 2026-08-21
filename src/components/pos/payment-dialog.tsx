"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import type { PaymentMethod } from "./types";

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
  totalPaisa,
  onClose,
  onConfirm,
  submitting,
}: {
  open: boolean;
  totalPaisa: number;
  onClose: () => void;
  onConfirm: (tenders: { method: PaymentMethod; amountPaisa: number }[]) => void;
  submitting: boolean;
}) {
  // Defaulting the cash tender to the full amount only works if this component remounts for
  // every new order — the caller passes key={order.id} on <PaymentDialog> for exactly that
  // reason, so this initializer runs fresh each time instead of only on the very first render.
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountRs: (totalPaisa / 100).toFixed(2) }]);
  const [cashGiven, setCashGiven] = useState("");

  const tenderedPaisa = tenders.reduce((a, t) => a + Math.round((parseFloat(t.amountRs) || 0) * 100), 0);
  const remainingPaisa = totalPaisa - tenderedPaisa;
  const changePaisa = Math.max(0, Math.round((parseFloat(cashGiven) || 0) * 100) - totalPaisa);

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
      tenders
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
          <div className="font-heading text-3xl font-bold tabular-nums text-primary">{formatPkr(totalPaisa)}</div>
        </div>

        <div className="space-y-3">
          {tenders.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={t.method} onValueChange={(v) => v && updateTender(i, { method: v as PaymentMethod })}>
                <SelectTrigger className="w-40">
                  <SelectValue />
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
          <Button variant="success" size="lg" onClick={confirm} disabled={remainingPaisa > 0 || submitting}>
            {submitting ? "Processing…" : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
