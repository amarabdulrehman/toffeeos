"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { XCircle } from "lucide-react";

interface Cancellation {
  id: string;
  orderNumber: number | null;
  reason: string;
  cancelledByName: string;
}

/** The dashboard-visible half of the cancellation-review loop — a cashier cancelling an order
 * already sent to the kitchen (see cancelSentOrder in src/server/orders.ts) always creates an
 * unreviewed OrderCancellation row; this is what puts it in front of a manager/owner instead of it
 * sitting silently in a report nobody opens. Same shape as LowStockBanner. */
export function CancellationBanner() {
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);

  useEffect(() => {
    fetch("/api/order-cancellations?unreviewedOnly=true")
      .then((r) => r.json())
      .then((d) => setCancellations(d.cancellations ?? []))
      .catch(() => {});
  }, []);

  if (cancellations.length === 0) return null;

  return (
    <Link
      href="/app/reports"
      className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm shadow-xs transition-colors hover:border-destructive/50"
    >
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div>
        <div className="font-semibold text-destructive">
          {cancellations.length} order{cancellations.length !== 1 ? "s" : ""} cancelled after being sent to the kitchen — needs review
        </div>
        <div className="mt-1 text-muted-foreground">
          {cancellations
            .slice(0, 3)
            .map((c) => `#${c.orderNumber ?? "?"} by ${c.cancelledByName} — ${c.reason}`)
            .join(" · ")}
          {cancellations.length > 3 ? ` · +${cancellations.length - 3} more` : ""}
        </div>
      </div>
    </Link>
  );
}
