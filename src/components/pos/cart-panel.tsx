"use client";

import { MapPin, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import { CustomerPicker } from "./customer-picker";
import { DiscountPicker } from "./discount-picker";
import type { CartLine, CustomerDto, Discount, OrderType, PreviewTotals } from "./types";

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "DINE_IN", label: "Dine-in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "SERVICE", label: "Service" },
];

export function CartPanel({
  orderType,
  onOrderTypeChange,
  tableLabel,
  onOpenTables,
  customer,
  onSelectCustomer,
  onClearCustomer,
  discount,
  onApplyDiscount,
  onClearDiscount,
  canApplyDiscount,
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
  tableLabel: string | undefined;
  onOpenTables: () => void;
  customer: CustomerDto | null;
  onSelectCustomer: (c: CustomerDto) => void;
  onClearCustomer: () => void;
  discount: Discount | null;
  onApplyDiscount: (d: Discount) => void;
  onClearDiscount: () => void;
  canApplyDiscount: boolean;
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
    <div className="flex h-full flex-col border-l bg-card">
      <div className="space-y-2 border-b p-4">
        <Select value={orderType} onValueChange={(v) => v && onOrderTypeChange(v as OrderType)}>
          <SelectTrigger className="w-full font-medium">
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
          <button
            onClick={onOpenTables}
            className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/50"
          >
            <MapPin className="size-4 text-muted-foreground" />
            {tableLabel ? <span className="font-medium">Table {tableLabel}</span> : <span className="text-muted-foreground">Select a table</span>}
          </button>
        )}

        <CustomerPicker customer={customer} onSelect={onSelectCustomer} onClear={onClearCustomer} />
        {canApplyDiscount && <DiscountPicker discount={discount} onApply={onApplyDiscount} onClear={onClearDiscount} />}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {lines.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
            <ShoppingBag className="size-8 opacity-40" />
            Tap items to add them to the order.
          </div>
        )}
        <div className="space-y-2">
          {lines.map((line) => (
            <div
              key={line.key}
              className="rounded-xl border border-border/60 bg-background p-3 transition-colors hover:border-border"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold leading-snug">{line.name}</div>
                <button
                  onClick={() => onRemoveLine(line.key)}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1 rounded-full border bg-muted/50 p-0.5">
                  <button
                    onClick={() => onQuantityChange(line.key, -1)}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium tabular-nums">{line.quantity}</span>
                  <button
                    onClick={() => onQuantityChange(line.key, 1)}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="font-heading text-sm font-semibold tabular-nums">
                  {formatPkr(line.unitPricePaisa * line.quantity)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 border-t bg-muted/30 p-4 text-sm">
        <Row label="Subtotal" value={totals?.discountedSubtotalPaisa} />
        {!!totals?.serviceChargePaisa && <Row label="Service charge" value={totals.serviceChargePaisa} />}
        <Row label={`Tax (${((totals?.appliedRateBasisPoints ?? 0) / 100).toFixed(0)}%)`} value={totals?.taxPaisa} />
        <div className="mt-2 flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2.5">
          <span className="font-heading text-sm font-semibold">Total</span>
          <span className="font-heading text-xl font-bold tabular-nums text-primary">
            {formatPkr(totals?.totalPaisa ?? 0)}
          </span>
        </div>
      </div>

      <div className="space-y-2 border-t p-4">
        <Button
          variant="outline"
          className="w-full"
          size="lg"
          disabled={lines.length === 0 || sending}
          onClick={onSendToKitchen}
        >
          {sending ? "Sending…" : "Send to Kitchen"}
        </Button>
        {canTakePayment && (
          <Button className="w-full" size="lg" disabled={lines.length === 0} onClick={onOpenPayment}>
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
      <span className={bold ? "text-foreground" : "tabular-nums"}>{formatPkr(value ?? 0)}</span>
    </div>
  );
}
