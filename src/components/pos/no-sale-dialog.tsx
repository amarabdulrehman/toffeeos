"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { printTicket } from "@/lib/print-ticket";
import { TicketPreview } from "@/components/print/ticket-preview";

/**
 * Opening the cash drawer with no sale — for change, or to clear a jam.
 *
 * A browser cannot open a drawer, so this does the two things it can. It puts the opening on record
 * with the reason, beside that day's drawer, where whoever counts it tonight sees it. Then it offers
 * a small slip to print: most receipt printers can be set to kick the drawer open with every print
 * job, and on those, printing this is what opens it.
 */
export function NoSaleDialog({ open, branchName, onClose }: { open: boolean; branchName: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState<{ at: string; reason: string } | null>(null);

  function close() {
    setReason("");
    setRecorded(null);
    onClose();
  }

  async function record() {
    setSaving(true);
    try {
      const res = await fetch("/api/cash-drawer/no-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not record that.");
        return;
      }
      setRecorded({ at: data.opening.at, reason: data.opening.reason });
    } catch {
      toast.error("You're offline — a no-sale opening needs a connection so it is on record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">No sale</DialogTitle>
        </DialogHeader>
        {!recorded ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Opening the drawer without a sale is recorded, with your name and the reason, on today&apos;s drawer.
            </p>
            <Input
              autoFocus
              placeholder="Why? e.g. change for a customer"
              aria-label="Reason for opening the drawer"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Recorded. Print the slip to open the drawer, or open it with its key.</p>
            <TicketPreview kind="receipt">
              <div className="print-area mx-auto w-[300px] font-mono text-[13px] leading-snug text-black">
                <div className="text-center text-base font-bold tracking-[0.3em]">NO SALE</div>
                <div className="text-center">{branchName}</div>
                <div className="my-2 border-t border-dashed border-black" />
                <div>{new Date(recorded.at).toLocaleString()}</div>
                <div>Reason: {recorded.reason}</div>
              </div>
            </TicketPreview>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {recorded ? "Done" : "Cancel"}
          </Button>
          {!recorded ? (
            <Button disabled={saving || reason.trim().length < 2} onClick={record}>
              Record
            </Button>
          ) : (
            <Button onClick={() => printTicket()}>
              <Printer className="size-4" />
              Print slip
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
