"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

interface Alert {
  id: string;
  quantityAtTrigger: number;
  thresholdAtTrigger: number;
  item: { name: string; unitOfMeasure: string };
  location: { name: string };
}

/** The in-app half of the low-stock "queue" — see the comment on LowStockAlert in schema.prisma.
 * A Phase 4 worker can drain the same ACTIVE rows to WhatsApp/email without touching this. */
export function LowStockBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetch("/api/inventory/low-stock-alerts")
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts ?? []))
      .catch(() => {});
  }, []);

  if (alerts.length === 0) return null;

  return (
    <Link
      href="/app/inventory"
      className="mt-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm shadow-xs transition-colors hover:border-warning/50"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <div className="font-semibold text-warning-foreground">
          {alerts.length} item{alerts.length !== 1 ? "s" : ""} running low
        </div>
        <div className="mt-1 text-muted-foreground">
          {alerts
            .slice(0, 3)
            .map((a) => `${a.item.name} at ${a.location.name} (${a.quantityAtTrigger} ${a.item.unitOfMeasure})`)
            .join(" · ")}
          {alerts.length > 3 ? ` · +${alerts.length - 3} more` : ""}
        </div>
      </div>
    </Link>
  );
}
