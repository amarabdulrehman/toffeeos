"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KitchenTicket } from "./kitchen-ticket";
import { printTicket } from "@/lib/print-ticket";

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
  }[];
}

export function KotDialog({
  order,
  branchName,
  onClose,
}: {
  /** Null closes the dialog — same open/close-by-value pattern as ReceiptDialog. */
  order: TicketOrder | null;
  branchName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Kitchen ticket — Order #{order?.orderNumber}</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-white p-4">
            <KitchenTicket order={order} branchName={branchName} />
          </div>
        )}
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
    </Dialog>
  );
}
