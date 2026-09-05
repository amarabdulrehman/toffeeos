"use client";

import { useMemo, useState } from "react";
import { addMonths, format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr, rupeesToPaisa, paisaToRupees } from "@/lib/money";
import { PAYMENT_METHODS, derivedMonthlyRatePaisa, type PaymentMethodKey } from "@/lib/billing";

const DURATION_PRESETS = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
];

/** Parses a plain "yyyy-MM-dd" <input type="date"> value as local-midnight, not UTC-midnight —
 * new Date("yyyy-MM-dd") parses as UTC per spec, which silently shifts the displayed date by the
 * browser's timezone offset. This keeps every date in this dialog meaning what it visually says. */
function parseDateInput(value: string): Date {
  return new Date(`${value}T00:00:00`);
}
function toDateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function RecordPaymentDialog({
  open,
  onClose,
  onRecorded,
  tenantId,
  tenantName,
  tenantStatus,
  currentPeriodEnd,
  effectiveMonthlyRatePaisa,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
  tenantId: string;
  tenantName: string;
  tenantStatus: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  currentPeriodEnd: string | null;
  effectiveMonthlyRatePaisa: number;
}) {
  const defaultStart = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!currentPeriodEnd) return today;
    const paidThrough = new Date(currentPeriodEnd);
    // Renewals stack onto the end of the current period, never restart today and silently
    // discard days the tenant already paid for.
    return paidThrough > today ? paidThrough : today;
  }, [currentPeriodEnd]);

  const [periodStart, setPeriodStart] = useState(() => toDateInputValue(defaultStart));
  const [periodEnd, setPeriodEnd] = useState(() => toDateInputValue(addMonths(defaultStart, 1)));
  const [amountRupees, setAmountRupees] = useState(() => paisaToRupees(effectiveMonthlyRatePaisa).toString());
  const [method, setMethod] = useState<PaymentMethodKey>("bank_transfer");
  const [note, setNote] = useState("");
  const [setAsRecurringRate, setSetAsRecurringRate] = useState(false);
  const [recurringRateRupees, setRecurringRateRupees] = useState(() => paisaToRupees(effectiveMonthlyRatePaisa).toString());
  const [submitting, setSubmitting] = useState(false);

  // Fresh defaults every time this dialog is opened come from the useState initializers above
  // running again on remount — the caller passes key={open ? "open" : "closed"} on this component
  // for exactly that reason, same pattern as the POS payment dialog's key={order.id ?? "closed"}.

  function applyPreset(months: number) {
    const start = parseDateInput(periodStart);
    const end = addMonths(start, months);
    setPeriodEnd(toDateInputValue(end));
    const amountPaisa = effectiveMonthlyRatePaisa * months;
    setAmountRupees(paisaToRupees(amountPaisa).toString());
  }

  const parsedStart = periodStart ? parseDateInput(periodStart) : null;
  const parsedEnd = periodEnd ? parseDateInput(periodEnd) : null;
  const amountPaisa = Math.max(0, rupeesToPaisa(parseFloat(amountRupees) || 0));
  const periodValid = !!parsedStart && !!parsedEnd && parsedEnd > parsedStart;
  const impliedMonthlyRate =
    periodValid && amountPaisa > 0 ? derivedMonthlyRatePaisa(amountPaisa, parsedStart!, parsedEnd!) : null;
  const willReactivate = tenantStatus !== "ACTIVE";

  async function submit() {
    if (!periodValid) {
      toast.error("Period end must be after period start.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaisa,
          periodStart: parsedStart!.toISOString(),
          periodEnd: parsedEnd!.toISOString(),
          method,
          note: note.trim() || undefined,
          setAsRecurringRate,
          recurringRatePaisa: setAsRecurringRate ? Math.max(0, rupeesToPaisa(parseFloat(recurringRateRupees) || 0)) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not record payment.");
        return;
      }
      toast.success(data.reactivated ? `Payment recorded — ${tenantName} reactivated.` : "Payment recorded.");
      onRecorded();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Record payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period-start">Period start</Label>
              <Input id="period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-end">Period end</Label>
              <Input id="period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((p) => (
              <Button key={p.months} type="button" variant="outline" size="sm" onClick={() => applyPreset(p.months)}>
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount (Rs)</Label>
              <Input
                id="amount"
                type="number"
                inputMode="decimal"
                min={0}
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => v && setMethod(v as PaymentMethodKey)}>
                <SelectTrigger className="w-full">
                  {/* Select.Value shows the raw value ("bank_transfer") without a render function —
                   * it never reads a SelectItem's children automatically. */}
                  <SelectValue>{(v: PaymentMethodKey) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. paid via JazzCash, ref #..." />
          </div>

          <div className="rounded-xl border bg-muted/20 px-3.5 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Set as their recurring monthly rate</div>
                <div className="text-xs text-muted-foreground">
                  {impliedMonthlyRate != null ? `Implied from this payment: ${formatPkr(impliedMonthlyRate, { showPaisa: true })}/month` : "Used for MRR reporting"}
                </div>
              </div>
              <Switch checked={setAsRecurringRate} onCheckedChange={setSetAsRecurringRate} />
            </div>
            {setAsRecurringRate && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="recurring-rate">Monthly rate (Rs)</Label>
                <Input
                  id="recurring-rate"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={recurringRateRupees}
                  onChange={(e) => setRecurringRateRupees(e.target.value)}
                />
              </div>
            )}
          </div>

          {periodValid && (
            <p className="text-sm text-muted-foreground">
              Covers {format(parsedStart!, "d MMM yyyy")} – {format(parsedEnd!, "d MMM yyyy")} ·{" "}
              <span className="font-medium text-foreground">{formatPkr(amountPaisa, { showPaisa: true })}</span>
            </p>
          )}

          {willReactivate && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              This will also reactivate <span className="font-medium">{tenantName}</span> (currently{" "}
              {tenantStatus.toLowerCase()}).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={submitting || !periodValid} onClick={submit}>
            {submitting ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
