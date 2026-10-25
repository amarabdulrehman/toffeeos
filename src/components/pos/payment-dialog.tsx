"use client";

import { useEffect, useMemo, useState } from "react";
import { Gift, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import {
  finalizeOrder,
  pricingLinesFromStored,
  settingsForOrderType,
  type BranchPricingSnapshot,
  type DiscountInput,
} from "@/lib/pricing";
import type { OrderDto, PaymentMethod } from "./types";

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
  order,
  pricingSnapshot,
  totalPaisa,
  onClose,
  onConfirm,
  submitting,
  offline = false,
  canComp = false,
  onComped,
}: {
  open: boolean;
  /** Null while the dialog is closed/unmounting — the live preview fetch below is skipped then. */
  orderId: string | null;
  /**
   * The order being paid, for re-pricing it here when the server cannot be reached. Everything the
   * engine needs is already on it: the lines with their own prices and discounts, the order-level
   * discount, its type, and whether it is tax-exempt.
   */
  order: OrderDto | null;
  /** The branch's tax rules and service-charge configuration, loaded with the page. The cart
   * already prices itself from this; payment now does too. */
  pricingSnapshot: BranchPricingSnapshot;
  totalPaisa: number;
  onClose: () => void;
  /** cashTenderedPaisa: what the customer handed over in cash, when it was entered. */
  onConfirm: (tenders: { method: PaymentMethod; amountPaisa: number }[], cashTenderedPaisa?: number) => void;
  submitting: boolean;
  /**
   * The device has no connection.
   *
   * Every method used to be refused except cash, because only the server could reprice an order at
   * a method's own tax rate, and a card taken at the stored cash-rate figure overcharged: a Rs 284
   * card bill went through as Rs 305, and the server accepted it because it only refuses payments
   * that fall short. The fix was not to keep refusing the card but to stop needing the server —
   * localTotals below runs the same finalizeOrder over the same inputs, so the amount is the one
   * the customer owes whether the line is up or down.
   */
  offline?: boolean;
  /** pos.order.comp: may give items, or the whole bill, free. */
  canComp?: boolean;
  /** After items were given free. `settled`: nothing was left to pay, and the order is closed. */
  onComped?: (orderId: string, settled: boolean) => void;
}) {
  const [comping, setComping] = useState(false);
  // Defaulting the cash tender to the full amount only works if this component remounts for
  // every new order — the caller passes key={order.id} on <PaymentDialog> for exactly that
  // reason, so this initializer runs fresh each time instead of only on the very first render.
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountRs: (totalPaisa / 100).toFixed(2) }]);
  const [cashGiven, setCashGiven] = useState("");
  // The order's persisted totalPaisa was computed at order-creation time assuming a CASH tender
  // (Punjab PRA's higher 16% rate) — it's only a placeholder until this resolves. Cash and card
  // are genuinely different totals (16% vs 8%), so "Amount due" must reflect whatever the cashier
  // currently has selected, not the number the order happened to be created with.
  // Tagged with the order version it priced. After items are given free the order changes under the
  // open dialog, and an answer for the old version would charge the old total: confirming quickly
  // took Rs 1,137 for a Rs 847 bill. Until the server answers for this version, the on-device total
  // (priced from the order as it now stands) is used.
  const [previewFor, setPreviewFor] = useState<{ version: number | undefined; totals: PreviewTotals } | null>(null);
  const preview = previewFor && previewFor.version === order?.version ? previewFor.totals : null;

  // Tenders is a plain array of primitives per entry; comparing it by value keeps the pricing
  // below from re-running on every render.
  const tendersKey = JSON.stringify(tenders);

  useEffect(() => {
    if (!orderId) return;
    const pricedVersion = order?.version;
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
        .then((d) => d.totals && setPreviewFor({ version: pricedVersion, totals: d.totals }))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, tendersKey, order?.version]);

  // The same pass the server's pay-preview makes, run here. Not an estimate and not a parallel
  // implementation: identical engine (finalizeOrder), identical line builder (pricingLinesFromStored),
  // identical inputs. The only thing the server has that this does not is a tax rule edited since
  // the page loaded, which the cart total already lives with.
  const localTotals = useMemo(() => {
    if (!order) return null;
    const lines = (order.lines ?? []).filter((l) => l.unitPricePaisa != null);
    // A locally-queued order that has never reached the server has no stored line prices to price
    // from. Nothing to fall back to but its own total, which is what it was created with.
    if (lines.length === 0) return null;

    const pricingLines = pricingLinesFromStored(
      lines.map((l) => ({
        id: l.id,
        unitPricePaisa: l.unitPricePaisa as number,
        quantity: l.quantity,
        isVoided: l.isVoided ?? false,
        isComplimentary: l.isComplimentary ?? false,
        discountType: l.discountType ?? null,
        discountValue: l.discountValue ?? null,
      }))
    );
    const orderDiscount: DiscountInput | undefined = order.discounts?.[0]
      ? { type: order.discounts[0].type, value: order.discounts[0].value }
      : undefined;
    // An exempt order is priced with no tax rules at all, exactly as the server does it.
    const taxRules = order.taxExemptReason != null ? [] : pricingSnapshot.taxRules;
    const active = tenders
      .map((t) => ({ method: t.method, amountPaisa: Math.round((parseFloat(t.amountRs) || 0) * 100) }))
      .filter((t) => t.amountPaisa > 0);

    return finalizeOrder(
      pricingLines,
      orderDiscount,
      taxRules,
      settingsForOrderType(pricingSnapshot, order.type),
      active.length > 0 ? active : [{ method: "CASH" as const, amountPaisa: 0 }]
    );
    // `tenders` is read inside but compared through tendersKey above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, pricingSnapshot, tendersKey]);

  // Server first when it answers, because a tax rule changed since page load lands there first.
  // Otherwise the local figure — which is why a failed request no longer silently falls back to
  // the order's stored cash-rate total, the way it did whenever the browser believed it was online
  // but nothing could actually reach the server.
  const dueTotalPaisa = preview?.totalPaisa ?? localTotals?.totalPaisa ?? totalPaisa;
  const shownTotals = preview ?? localTotals;

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
  // Change comes out of the cash part only. On a split bill it used to be worked out against the
  // whole total, so Rs 500 handed over for the cash half of a Rs 600 bill showed no change at all.
  const cashPartPaisa = effectiveTenders
    .filter((t) => t.method === "CASH")
    .reduce((a, t) => a + Math.round((parseFloat(t.amountRs) || 0) * 100), 0);
  const cashGivenPaisa = Math.round((parseFloat(cashGiven) || 0) * 100);
  const changePaisa = Math.max(0, cashGivenPaisa - cashPartPaisa);
  // Typed something, but not enough to cover what is owed in cash: that is a mistake to catch here,
  // not a figure to save — the server refuses it too.
  const cashShort = cashGiven.trim() !== "" && cashPartPaisa > 0 && cashGivenPaisa < cashPartPaisa;

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
        .filter((t) => t.amountPaisa > 0),
      cashPartPaisa > 0 && cashGivenPaisa > 0 ? cashGivenPaisa : undefined
    );
  }

  const comped = (order?.lines ?? []).filter((l) => l.isComplimentary && !l.isVoided);

  if (comping && order) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <CompPanel
            order={order}
            onCancel={() => setComping(false)}
            onDone={(settled) => {
              setComping(false);
              onComped?.(order.id, settled);
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Take payment</DialogTitle>
        </DialogHeader>

        {comped.length > 0 && (
          <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="comped-items">
            <span className="font-medium text-foreground">Complimentary:</span>{" "}
            {comped.map((l) => `${l.quantity}× ${l.nameSnapshot}`).join(", ")}
          </div>
        )}

        <div className="rounded-xl bg-primary/10 px-4 py-3.5 text-center shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Amount due</div>
          <div className="font-heading text-3xl font-bold tabular-nums text-primary">{formatPkr(dueTotalPaisa)}</div>
          {shownTotals && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              incl. {formatPkr(shownTotals.taxPaisa)} tax
              {shownTotals.tenders.length === 1 &&
                ` (${(shownTotals.tenders[0].rateBasisPoints / 100).toFixed(0)}%)`}
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={addTender}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Plus className="size-3.5" />
              Split payment
            </button>
            {/* Beside the ways of paying, because that's where a cashier reaches for it, but not one
                of them: giving food free isn't money taken. See compOrderItems. Online only, like
                adding items: it changes what the order is. */}
            {canComp && order && (
              <button
                onClick={() => setComping(true)}
                disabled={offline}
                title={offline ? "Needs a connection" : undefined}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <Gift className="size-3.5" />
                Complimentary
              </button>
            )}
          </div>

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
          {cashShort && (
            <p role="alert" className="text-sm font-medium text-destructive">
              That&apos;s less than the {formatPkr(cashPartPaisa)} owed in cash.
            </p>
          )}

          {offline && (
            <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
              You&apos;re offline. The amount is worked out on this device at the right rate for the method
              chosen, and the payment is recorded when the connection is back.
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
          <Button variant="success" size="lg" onClick={confirm} disabled={remainingPaisa > 0 || submitting || cashShort}>
            {submitting ? "Processing…" : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const COMP_REASONS = ["Owner's guest", "Sorry for the wait", "Regular customer", "Staff meal"];

/**
 * Give the whole bill, or some items, free. A reason is required; it goes on the order with who
 * gave it, and into the reports beside the value given away.
 */
function CompPanel({ order, onCancel, onDone }: { order: OrderDto; onCancel: () => void; onDone: (settled: boolean) => void }) {
  const live = (order.lines ?? []).filter((l) => !l.isVoided && !l.isComplimentary);
  const [mode, setMode] = useState<"all" | "items">("all");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = Object.entries(picked)
    .filter(([, q]) => q > 0)
    .map(([lineId, quantity]) => ({ lineId, quantity }));
  const priceOf = (lineId: string) => live.find((l) => l.id === lineId)?.unitPricePaisa ?? 0;
  const value =
    mode === "all"
      ? live.reduce((a, l) => a + (l.unitPricePaisa ?? 0) * l.quantity, 0)
      : items.reduce((a, it) => a + priceOf(it.lineId) * it.quantity, 0);
  const ready = reason.trim().length >= 2 && (mode === "all" || items.length > 0) && !busy;

  async function give() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/comp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), ...(mode === "items" ? { items } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't give that complimentary.");
        return;
      }
      onDone(Boolean(data.settled));
    } catch {
      setError("Couldn't reach the server — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading">Complimentary — order #{order.orderNumber}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div role="group" aria-label="What to give" className="grid grid-cols-2 gap-2">
          <Button variant={mode === "all" ? "default" : "outline"} aria-pressed={mode === "all"} onClick={() => setMode("all")}>
            Whole bill
          </Button>
          <Button variant={mode === "items" ? "default" : "outline"} aria-pressed={mode === "items"} onClick={() => setMode("items")}>
            Some items
          </Button>
        </div>

        {mode === "items" && (
          <ul className="space-y-1.5">
            {live.map((l) => {
              const q = picked[l.id] ?? 0;
              const set = (n: number) => setPicked((p) => ({ ...p, [l.id]: Math.max(0, Math.min(l.quantity, n)) }));
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {l.quantity}× {l.nameSnapshot}
                    <span className="ml-1.5 text-muted-foreground">{formatPkr((l.unitPricePaisa ?? 0) * l.quantity)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" aria-label={`One less ${l.nameSnapshot} free`} disabled={q === 0} onClick={() => set(q - 1)}>
                      −
                    </Button>
                    <span className="w-6 text-center tabular-nums" data-testid={`comp-qty-${l.nameSnapshot}`}>
                      {q}
                    </span>
                    <Button size="sm" variant="outline" aria-label={`One more ${l.nameSnapshot} free`} disabled={q === l.quantity} onClick={() => set(q + 1)}>
                      +
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1.5">
          <label htmlFor="comp-reason" className="text-sm font-medium">
            Reason (required)
          </label>
          <Input id="comp-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Why is it free?" />
          <div className="flex flex-wrap gap-1.5">
            {COMP_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {formatPkr(value)} at menu price, given free. It isn&apos;t counted as a sale; stock still comes out.
        </p>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onCancel}>
          Back
        </Button>
        <Button size="lg" onClick={give} disabled={!ready}>
          {busy ? "Giving…" : mode === "all" ? "Give whole bill free" : "Give free"}
        </Button>
      </DialogFooter>
    </>
  );
}
