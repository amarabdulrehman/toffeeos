"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OrderBill } from "@/lib/bill";
import { Receipt } from "./receipt";
import type { OrderDto } from "./types";

type Loaded = { orderId: string; order: OrderDto; bill: OrderBill } | { orderId: string; error: string };

/**
 * The bill a table asks for before paying.
 *
 * Priced by the server every time it opens, never from the till's copy of the order: the only
 * figure the till has is the provisional cash-rate total, and a bill has to show what each way of
 * paying will really cost. That also means it needs a connection — offline it says so plainly
 * rather than printing a number that could be wrong.
 */
export function BillDialog({
  orderId,
  tenantName,
  branchName,
  logoUrl,
  showLogo,
  receiptHeader,
  onClose,
}: {
  /** Null closes the dialog. */
  orderId: string | null;
  tenantName: string;
  branchName: string;
  logoUrl?: string | null;
  showLogo?: boolean;
  receiptHeader?: string | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    fetch(`/api/orders/${orderId}/bill`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setLoaded(
          res.ok
            ? { orderId, order: body.order as OrderDto, bill: body.bill as OrderBill }
            : { orderId, error: body.error ?? "Could not prepare the bill." }
        );
      })
      .catch(() => {
        if (!cancelled) setLoaded({ orderId, error: "Could not reach the server to price the bill. Check the connection." });
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Whatever was loaded for a different order is not this one's bill — show the loading state
  // rather than the previous table's figures for a moment.
  const current = loaded && loaded.orderId === orderId ? loaded : null;

  return (
    <Dialog open={!!orderId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">
            Bill{current && "order" in current ? ` — Order #${current.order.orderNumber}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-white p-4">
          {!current && (
            <div className="space-y-2" aria-label="Preparing the bill">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
          {current && "error" in current && <p className="text-sm text-destructive">{current.error}</p>}
          {current && "order" in current && (
            <Receipt
              order={current.order}
              bill={current.bill}
              tenantName={tenantName}
              branchName={branchName}
              logoUrl={logoUrl}
              showLogo={showLogo}
              receiptHeader={receiptHeader}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!current || "error" in current} onClick={() => window.print()}>
            <Printer className="size-4" />
            Print bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
