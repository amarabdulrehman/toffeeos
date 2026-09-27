"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Receipt } from "./receipt";
import type { OrderDto } from "./types";
import { printTicket } from "@/lib/print-ticket";
import { TicketPreview } from "@/components/print/ticket-preview";

export function ReceiptDialog({
  order,
  tenantName,
  branchName,
  logoUrl,
  showLogo,
  receiptHeader,
  showCredit,
  onClose,
}: {
  /** Null closes the dialog — same open/close-by-value pattern as PaymentDialog/VariantDialog
   * elsewhere in this folder, rather than a separate boolean prop. */
  order: OrderDto | null;
  tenantName: string;
  branchName: string;
  logoUrl?: string | null;
  showLogo?: boolean;
  receiptHeader?: string | null;
  /** Tenant.showReceiptCredit. */
  showCredit?: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Receipt — Order #{order?.orderNumber}</DialogTitle>
        </DialogHeader>
        {order && (
          <TicketPreview kind="receipt">
            <Receipt order={order} tenantName={tenantName} branchName={branchName} logoUrl={logoUrl} showLogo={showLogo} receiptHeader={receiptHeader} showCredit={showCredit} />
          </TicketPreview>
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
