"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPkr } from "@/lib/money";
import type { OrderDto } from "./types";

/**
 * A whole-bill discount on an order already punched, before it's paid: give one, change it, or
 * take it off. Shared by the Manage window and the payment window. The server applies the same
 * permission and the branch's discount ceiling as at the till (setOrderDiscount). `onDone` runs
 * after the change is saved, to re-read the order.
 */
export function OrderDiscountForm({ order, onDone }: { order: OrderDto; onDone: () => void | Promise<void> }) {
  const current = (order.discounts ?? [])[0] ?? null;
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(method: "PUT" | "DELETE", body?: unknown, done?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/discount`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't change the discount.");
        return;
      }
      toast.success(done ?? "Discount saved.");
      setAmount("");
      setReason("");
      await onDone();
    } catch {
      toast.error("Couldn't reach the server — check the connection.");
    } finally {
      setBusy(false);
    }
  }

  if (current?.loyaltyPointsRedeemed) {
    return (
      <p className="text-sm text-muted-foreground">
        {current.loyaltyPointsRedeemed} loyalty points were spent on this bill ({formatPkr(current.value)} off), so another
        discount can&apos;t be added.
      </p>
    );
  }

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && (type === "FIXED" || n <= 100);

  return (
    <div className="space-y-2">
      {current && (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="current-discount">
          <span>
            <span className="font-medium">
              {current.type === "PERCENT" ? `${(current.value / 100).toFixed(current.value % 100 ? 2 : 0)}% off` : `${formatPkr(current.value)} off`}
            </span>
            {current.reason ? <span className="text-muted-foreground"> · {current.reason}</span> : null}
          </span>
          <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => send("DELETE", undefined, "Discount taken off.")}>
            Remove
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <div role="group" aria-label="Discount type" className="flex shrink-0 gap-1">
          <Button size="sm" variant={type === "PERCENT" ? "default" : "outline"} aria-pressed={type === "PERCENT"} onClick={() => setType("PERCENT")}>
            %
          </Button>
          <Button size="sm" variant={type === "FIXED" ? "default" : "outline"} aria-pressed={type === "FIXED"} onClick={() => setType("FIXED")}>
            Rs
          </Button>
        </div>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          aria-label={type === "PERCENT" ? "Discount percent" : "Discount amount in rupees"}
          placeholder={type === "PERCENT" ? "e.g. 10" : "e.g. 200"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-9"
        />
      </div>
      <Input
        aria-label="Reason for the discount"
        placeholder="Reason (optional), e.g. sorry for the wait"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-9"
      />
      <Button
        className="w-full"
        disabled={!valid || busy}
        onClick={() =>
          send(
            "PUT",
            { type, value: Math.round(n * 100), reason: reason.trim() || undefined },
            current ? "Discount changed." : "Discount given."
          )
        }
      >
        {current ? "Change discount" : "Give discount"}
      </Button>
    </div>
  );
}
