"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KitchenTicket } from "./kitchen-ticket";
import { printTicket } from "@/lib/print-ticket";
import { TicketPreview } from "@/components/print/ticket-preview";

interface TicketOrder {
  orderNumber: number;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
  source: "POS" | "ONLINE" | "QR";
  sentToKitchenAt: string | null;
  table: { label: string } | null;
  lines: {
    id: string;
    nameSnapshot: string;
    quantity: number;
    notes: string | null;
    modifiers?: { id: string; nameSnapshot: string }[];
    isVoided?: boolean;
    kitchenRound?: number;
  }[];
}

export function KotDialog({
  order,
  branchName,
  onClose,
  addedOnly = false,
}: {
  /** Null closes the dialog — same open/close-by-value pattern as ReceiptDialog. */
  order: TicketOrder | null;
  branchName: string;
  onClose: () => void;
  /** Open on the latest added items rather than the whole order: set right after items are added. */
  addedOnly?: boolean;
}) {
  // Remounted per order (key below), so the choice starts fresh each time the dialog opens.
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      {order && <KotDialogBody key={`${order.orderNumber}:${addedOnly}`} order={order} branchName={branchName} onClose={onClose} addedOnly={addedOnly} />}
    </Dialog>
  );
}

function KotDialogBody({
  order,
  branchName,
  onClose,
  addedOnly,
}: {
  order: TicketOrder;
  branchName: string;
  onClose: () => void;
  addedOnly: boolean;
}) {
  const live = order.lines.filter((l) => !l.isVoided);
  const latestRound = Math.max(1, ...live.map((l) => l.kitchenRound ?? 1));
  // Only offered once something has been added after the first send; a single round is the order.
  const hasAddOns = latestRound > 1 && live.some((l) => (l.kitchenRound ?? 1) === latestRound);
  const [scope, setScope] = useState<"added" | "all">(addedOnly && hasAddOns ? "added" : "all");
  const onlyRound = hasAddOns && scope === "added" ? latestRound : undefined;
  return (
    <>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Kitchen ticket — Order #{order.orderNumber}</DialogTitle>
        </DialogHeader>
        {hasAddOns && (
          <div role="group" aria-label="What to print" className="grid grid-cols-2 gap-2">
            <Button variant={scope === "added" ? "default" : "outline"} aria-pressed={scope === "added"} onClick={() => setScope("added")}>
              Added items only
            </Button>
            <Button variant={scope === "all" ? "default" : "outline"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              Whole order
            </Button>
          </div>
        )}
        <TicketPreview kind="kitchen">
          <KitchenTicket order={order} branchName={branchName} onlyRound={onlyRound} />
        </TicketPreview>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => printTicket()}>
            <Printer className="size-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}
