"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatPkr } from "@/lib/money";
import type { CartLine, FloorDto, OrderType, PreviewTotals } from "./types";

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "DINE_IN", label: "Dine-in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "SERVICE", label: "Service" },
];

export function CartPanel({
  orderType,
  onOrderTypeChange,
  floors,
  tableId,
  onTableChange,
  lines,
  onQuantityChange,
  onRemoveLine,
  totals,
  canTakePayment,
  onSendToKitchen,
  onOpenPayment,
  sending,
}: {
  orderType: OrderType;
  onOrderTypeChange: (t: OrderType) => void;
  floors: FloorDto[];
  tableId: string | undefined;
  onTableChange: (id: string) => void;
  lines: CartLine[];
  onQuantityChange: (key: string, delta: number) => void;
  onRemoveLine: (key: string) => void;
  totals: PreviewTotals | null;
  canTakePayment: boolean;
  onSendToKitchen: () => void;
  onOpenPayment: () => void;
  sending: boolean;
}) {
  return (
    <div className="flex h-full flex-col border-l bg-muted/20">
      <div className="space-y-2 border-b p-3">
        <Select value={orderType} onValueChange={(v) => v && onOrderTypeChange(v as OrderType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {orderType === "DINE_IN" && (
          <Select value={tableId} onValueChange={(v) => v && onTableChange(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a table" />
            </SelectTrigger>
            <SelectContent>
              {floors.flatMap((f) =>
                f.tables.map((t) => (
                  <SelectItem key={t.id} value={t.id} disabled={t.status === "OCCUPIED" && t.id !== tableId}>
                    {f.name} · {t.label} ({t.seats} seats){t.status === "OCCUPIED" ? " — occupied" : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {lines.length === 0 && (
          <div className="mt-8 text-center text-sm text-muted-foreground">Tap items to add them to the order.</div>
        )}
        <div className="space-y-3">
          {lines.map((line) => (
            <div key={line.key} className="rounded-lg border bg-background p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{line.name}</div>
                <button onClick={() => onRemoveLine(line.key)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => onQuantityChange(line.key, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-5 text-center text-sm">{line.quantity}</span>
                  <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => onQuantityChange(line.key, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-sm font-semibold">{formatPkr(line.unitPricePaisa * line.quantity)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1 border-t p-3 text-sm">
        <Row label="Subtotal" value={totals?.discountedSubtotalPaisa} />
        {!!totals?.serviceChargePaisa && <Row label="Service charge" value={totals.serviceChargePaisa} />}
        <Row label={`Tax (${((totals?.appliedRateBasisPoints ?? 0) / 100).toFixed(0)}%)`} value={totals?.taxPaisa} />
        <Separator className="my-2" />
        <Row label="Total" value={totals?.totalPaisa} bold />
      </div>

      <div className="space-y-2 border-t p-3">
        <Button className="w-full" size="lg" disabled={lines.length === 0 || sending} onClick={onSendToKitchen}>
          {sending ? "Sending…" : "Send to Kitchen"}
        </Button>
        {canTakePayment && (
          <Button className="w-full" variant="secondary" disabled={lines.length === 0} onClick={onOpenPayment}>
            Take Payment
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value?: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-bold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={bold ? "text-foreground" : ""}>{formatPkr(value ?? 0)}</span>
    </div>
  );
}
