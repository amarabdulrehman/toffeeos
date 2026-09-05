"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { OrderDto } from "./types";

/** The cashier-facing "cancel an order already sent to the kitchen" flow — a reason is mandatory
 * (unlike the manager Void action's window.prompt, which stays optional) because this always
 * creates a reviewable OrderCancellation row a manager/owner has to see. See the doc comment on
 * cancelSentOrder in src/server/orders.ts for why this is a separate action from Void. */
export function CancelOrderDialog({
  order,
  onClose,
  onConfirm,
}: {
  order: OrderDto | null;
  onClose: () => void;
  onConfirm: (order: OrderDto, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setReason("");
      onClose();
    }
  }

  async function handleConfirm() {
    if (!order || reason.trim().length === 0) return;
    setSubmitting(true);
    try {
      await onConfirm(order, reason.trim());
      setReason("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order #{order?.orderNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This order has already been sent to the kitchen. Cancelling it will notify a manager or
            owner for review — a reason is required.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason for cancellation</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer changed their mind, ordered by mistake, kitchen out of stock…"
              rows={3}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Never mind
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={reason.trim().length === 0 || submitting}
          >
            {submitting ? "Cancelling…" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
