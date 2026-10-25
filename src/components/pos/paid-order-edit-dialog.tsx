"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPkr } from "@/lib/money";
import { CustomerPicker } from "./customer-picker";
import type { OrderDto, PaymentMethod } from "./types";

/**
 * What can be changed on a paid bill: how it was paid, and who it was for. Never its items or
 * amounts — those go through Refund, which leaves the record. See src/server/paid-order-edits.ts.
 */

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "JAZZCASH", label: "JazzCash" },
  { value: "EASYPAISA", label: "Easypaisa" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
];
const label = (m: string) => METHODS.find((x) => x.value === m)?.label ?? m;

interface Corrected {
  from: string;
  to: string;
  oldTotalPaisa: number;
  newTotalPaisa: number;
  differencePaisa: number;
}

export function PaidOrderEditDialog({
  order,
  canCorrectPayment,
  canAddCustomer,
  onClose,
  onChanged,
}: {
  order: OrderDto | null;
  canCorrectPayment: boolean;
  canAddCustomer: boolean;
  onClose: () => void;
  /** Something was saved: the queue reloads. */
  onChanged: () => void;
}) {
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit paid order #{order?.orderNumber}</DialogTitle>
        </DialogHeader>
        {order && (
          <EditBody key={order.id} order={order} canCorrectPayment={canCorrectPayment} canAddCustomer={canAddCustomer} onClose={onClose} onChanged={onChanged} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditBody({
  order,
  canCorrectPayment,
  canAddCustomer,
  onClose,
  onChanged,
}: {
  order: OrderDto;
  canCorrectPayment: boolean;
  canAddCustomer: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const payments = order.payments ?? [];
  const current = payments.length === 1 ? payments[0].method : null;
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [corrected, setCorrected] = useState<Corrected | null>(null);
  const [customer, setCustomer] = useState(order.customer ?? null);

  // Why the method can't be changed here, if it can't. The server says the same.
  const blocked =
    payments.length === 0
      ? "Nothing was paid on this bill."
      : payments.length > 1
        ? "This bill was split across payment methods, which can't be corrected here yet. Refund it and take payment again."
        : (order.refundedPaisa ?? 0) > 0
          ? "This bill has refunds against it, so its payment method can't be changed. Refund the rest and take payment again."
          : null;

  async function correct() {
    if (!method) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/payment-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't change the payment method.");
        return;
      }
      setCorrected({
        from: data.from,
        to: data.to,
        oldTotalPaisa: data.oldTotalPaisa,
        newTotalPaisa: data.order.totalPaisa,
        differencePaisa: data.differencePaisa,
      });
      onChanged();
    } catch {
      toast.error("Couldn't reach the server — check the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function addCustomer(c: { id: string; name: string | null; phone: string | null }) {
    try {
      const res = await fetch(`/api/orders/${order.id}/customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: c.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't add the customer.");
        return;
      }
      setCustomer({ id: c.id, name: c.name, phone: c.phone, loyaltyPoints: 0 });
      toast.success(`Added ${c.name ?? c.phone} to order #${order.orderNumber}.`);
      onChanged();
    } catch {
      toast.error("Couldn't reach the server — check the connection.");
    }
  }

  return (
    <>
      <div className="space-y-5">
        {canCorrectPayment && (
          <section className="space-y-2.5">
            <h3 className="text-sm font-semibold">Payment method</h3>
            {corrected ? (
              <div role="status" className="space-y-1 rounded-xl border-2 border-primary/40 bg-primary/5 p-3 text-sm" data-testid="payment-corrected">
                <div className="font-medium">
                  Changed from {label(corrected.from)} to {label(corrected.to)}.
                </div>
                {corrected.differencePaisa === 0 ? (
                  <div>The bill is the same: {formatPkr(corrected.newTotalPaisa)}.</div>
                ) : (
                  <>
                    <div>
                      The bill by {label(corrected.to).toLowerCase()} is {formatPkr(corrected.newTotalPaisa)} (was{" "}
                      {formatPkr(corrected.oldTotalPaisa)}), because tax depends on how it&apos;s paid.
                    </div>
                    <div className="font-semibold">
                      {corrected.differencePaisa < 0
                        ? `If the customer paid ${formatPkr(corrected.oldTotalPaisa)}, give back ${formatPkr(-corrected.differencePaisa)}.`
                        : `Collect ${formatPkr(corrected.differencePaisa)} more. If you can't, the takings will show that much short.`}
                    </div>
                  </>
                )}
              </div>
            ) : blocked ? (
              <p className="text-sm text-muted-foreground">{blocked}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Recorded as <span className="font-medium text-foreground">{label(current!)}</span>,{" "}
                  {formatPkr(order.paidPaisa ?? order.totalPaisa)}. If that&apos;s wrong, pick how it was actually paid.
                </p>
                <div role="group" aria-label="Actually paid by" className="grid grid-cols-3 gap-2">
                  {METHODS.filter((m) => m.value !== current).map((m) => (
                    <Button key={m.value} size="sm" variant={method === m.value ? "default" : "outline"} aria-pressed={method === m.value} onClick={() => setMethod(m.value)}>
                      {m.label}
                    </Button>
                  ))}
                </div>
                <Input
                  aria-label="Reason for changing the payment method"
                  placeholder="Why? e.g. pressed Cash, customer paid by card"
                  value={reason}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button className="w-full" disabled={!method || reason.trim().length < 2 || busy} onClick={correct}>
                  {busy ? "Changing…" : method ? `Change to ${label(method)}` : "Pick how it was paid"}
                </Button>
              </>
            )}
          </section>
        )}

        {canAddCustomer && (
          <section className="space-y-2.5">
            <h3 className="text-sm font-semibold">Customer</h3>
            {customer ? (
              <p className="text-sm">
                {customer.name ?? "Customer"}
                {customer.phone ? <span className="text-muted-foreground"> · {customer.phone}</span> : null}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Paid without a customer. Add them and they get the points for it.</p>
                <CustomerPicker customer={null} onSelect={addCustomer} onClear={() => {}} />
              </>
            )}
          </section>
        )}

        <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Items and amounts on a paid bill don&apos;t change. To take something off, use Refund: it can refund single items.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
