"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPkr } from "@/lib/money";

export interface DeletableOrder {
  id: string;
  orderNumber: number;
  totalPaisa: number;
  /** Paid orders used stock at payment, so only they can put it back. */
  paid: boolean;
}

/**
 * The owner removing an order from the books.
 *
 * Asks for three things, each for a reason: why (the log is only worth something with one), whether
 * the food was ever made (stock was used when the order was paid), and the owner's password — so a
 * till left signed in as the owner isn't enough to do this.
 */
export function DeleteOrderDialog({
  order,
  onClose,
  onDeleted,
}: {
  order: DeletableOrder | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setReason("");
    setRestock(false);
    setPassword("");
  }

  async function submit() {
    if (!order) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), password, restock: order.paid && restock }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A wrong password clears the field; everything else is kept so nothing has to be retyped.
        if (res.status === 401) setPassword("");
        toast.error(data.error ?? "Could not delete this order.");
        return;
      }
      toast.success(`Order #${order.orderNumber} deleted. It's in the Deleted orders log.`);
      reset();
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  const valid = reason.trim().length >= 3 && password.length > 0;

  return (
    <Dialog
      open={!!order}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Delete order #{order?.orderNumber}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {order?.paid ? (
              <>
                Its {formatPkr(order.totalPaisa)} comes out of sales, the reports and today&apos;s cash drawer.
              </>
            ) : (
              <>It disappears from the queue and the kitchen.</>
            )}{" "}
            A record of it — what it was, who deleted it and why — is kept in the Deleted orders log, and
            can&apos;t be removed.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="delete-reason">Why is it being deleted?</Label>
            <Textarea
              id="delete-reason"
              rows={2}
              maxLength={280}
              placeholder="e.g. Test order, entered twice, wrong table"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {order?.paid && (
            <label className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
              <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} className="mt-0.5" />
              <span>
                The food was never made — put its ingredients back into stock
                <span className="block text-xs text-muted-foreground">Leave unticked if it was cooked and served.</span>
              </span>
            </label>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="delete-password">Your password</Label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Never mind
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !valid}>
            {busy ? "Deleting…" : "Delete order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
