"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Taking one item (or some of a quantity) off an unpaid order: the Void button and the small form
 * it opens, asking how many and why. Shared by the Manage window and the table's order panel, so
 * the item a guest changed their mind about is one tap away where the order is being looked at,
 * rather than two windows deep. What happens on confirm is the caller's (`onVoid`); it resolves
 * true when the void went through.
 */
export function VoidLine({
  line,
  isLastItem,
  busy,
  onVoid,
}: {
  line: { id: string; nameSnapshot: string; quantity: number };
  /** The only thing left on the order: that's a void of the whole order, which has its own button. */
  isLastItem: boolean;
  busy: boolean;
  onVoid: (quantity: number, reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        disabled={busy || isLastItem}
        title={isLastItem ? "The last item — void the whole order instead" : undefined}
        onClick={() => {
          setQuantity(1);
          setReason("");
          setOpen(true);
        }}
        aria-label={`Void ${line.nameSnapshot}`}
      >
        Void
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border bg-muted/40 p-3 no-underline">
      {line.quantity > 1 && (
        <div className="flex items-center gap-2">
          <Label htmlFor={`void-qty-${line.id}`} className="text-xs">
            How many
          </Label>
          <Input
            id={`void-qty-${line.id}`}
            type="number"
            min={1}
            max={line.quantity}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(line.quantity, Number(e.target.value) || 1)))}
            className="h-9 w-20"
          />
          <span className="text-xs text-muted-foreground">of {line.quantity}</span>
        </div>
      )}
      <Input
        placeholder="Why? e.g. customer changed their mind"
        aria-label="Reason for voiding"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          Keep it
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy || reason.trim().length < 2}
          onClick={async () => {
            if (await onVoid(quantity, reason.trim())) setOpen(false);
          }}
        >
          {quantity > 1 ? `Yes, void ${quantity}` : "Yes, void it"}
        </Button>
      </div>
    </div>
  );
}
