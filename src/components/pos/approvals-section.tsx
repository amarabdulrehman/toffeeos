"use client";

import { useState } from "react";
import { ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** GET /api/orders/approvals — see PendingApprovalDto in src/server/order-approvals.ts. */
export interface PendingApproval {
  id: string;
  kind: "NEW_ORDER" | "MORE_ITEMS";
  orderId: string;
  orderNumber: number;
  orderType: string;
  tableLabel: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  items: { name: string; quantity: number; notes: string | null; modifiers: string[] }[];
}

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  SERVICE: "Service",
};

function minutesAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins === 0 ? "just now" : `${mins} min ago`;
}

/**
 * Waiter orders and rounds waiting for the counter, at the top of the Order Queue: what was asked
 * for, by whom, for which table — and Send to kitchen or Reject. A rejection needs a reason, which
 * the waiter is shown, so they can tell the table.
 */
export function ApprovalsSection({
  approvals,
  busyId,
  onApprove,
  onReject,
}: {
  approvals: PendingApproval[];
  /** The request being decided right now; its buttons wait. */
  busyId: string | null;
  onApprove: (approval: PendingApproval) => void;
  onReject: (approval: PendingApproval, reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (approvals.length === 0) return null;
  return (
    <section aria-label="Waiting for approval" className="space-y-2.5">
      <h3 className="text-sm font-semibold text-warning-foreground">Waiting for your approval ({approvals.length})</h3>
      {approvals.map((a) => {
        const where = a.tableLabel ? `Table ${a.tableLabel}` : (TYPE_LABEL[a.orderType] ?? a.orderType);
        const busy = busyId === a.id;
        return (
          <div
            key={a.id}
            className="rounded-xl border-2 border-warning/60 bg-warning/5 p-4"
            data-testid="approval-request"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-heading font-semibold">
                  {a.kind === "NEW_ORDER" ? `New order #${a.orderNumber}` : `More items for order #${a.orderNumber}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {where}
                  {a.requestedByName ? ` · by ${a.requestedByName}` : ""} · {minutesAgo(a.requestedAt)}
                </div>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5 text-sm">
              {a.items.map((item, i) => (
                <li key={i}>
                  {item.quantity}× {item.name}
                  {item.modifiers.length > 0 && (
                    <span className="text-muted-foreground"> + {item.modifiers.join(", ")}</span>
                  )}
                  {item.notes && <span className="italic text-muted-foreground"> — {item.notes}</span>}
                </li>
              ))}
            </ul>
            {rejecting === a.id ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim().length < 2) return;
                  onReject(a, reason.trim());
                  setRejecting(null);
                  setReason("");
                }}
              >
                <Input
                  autoFocus
                  aria-label={`Why is order #${a.orderNumber} rejected?`}
                  placeholder="Why? e.g. item finished, table not seated"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setRejecting(null)}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    className="flex-1"
                    disabled={busy || reason.trim().length < 2}
                  >
                    Reject
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setRejecting(a.id);
                    setReason("");
                  }}
                >
                  Reject
                </Button>
                <Button className="flex-1" disabled={busy} onClick={() => onApprove(a)}>
                  <ChefHat className="size-4" />
                  Send to kitchen
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
