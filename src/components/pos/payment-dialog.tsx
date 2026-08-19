"use client";

import { useState } from "react";
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
          <DialogTitle>Take payment — {formatPkr(totalPaisa)} due</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {tenders.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={t.method} onValueChange={(v) => updateTender(i, { method: v as PaymentMethod })}>
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
                className="flex-1"
              />
              {tenders.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeTender(i)}>
                  ✕
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addTender}>
            + Split payment
          </Button>

          {tenders.some((t) => t.method === "CASH") && (
            <div className="rounded-md border bg-muted/30 p-2 text-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-muted-foreground">Cash given:</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={cashGiven}
                  onChange={(e) => setCashGiven(e.target.value)}
                  className="h-7 w-28"
                />
              </div>
              <div>Change due: <span className="font-semibold">{formatPkr(changePaisa)}</span></div>
            </div>
          )}

          <div className={`text-sm font-medium ${remainingPaisa > 0 ? "text-destructive" : "text-emerald-600"}`}>
            {remainingPaisa > 0 ? `${formatPkr(remainingPaisa)} remaining` : "Fully covered"}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={remainingPaisa > 0 || submitting}>
            {submitting ? "Processing…" : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
