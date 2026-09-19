"use client";

import { useState } from "react";
import { MapPin, Minus, NotebookPen, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  deliveryAddress,
  onDeliveryAddressChange,
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
  onNoteChange,
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
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;
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
  onNoteChange: (key: string, notes: string) => void;
  totals: PreviewTotals | null;
  canTakePayment: boolean;
  onSendToKitchen: () => void;
  onOpenPayment: () => void;
  sending: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-card">
      <div className="space-y-2 border-b p-4">
        <Select value={orderType} onValueChange={(v) => v && onOrderTypeChange(v as OrderType)}>
          {/* The trigger renders a value, not a label, so on its own it announces as an unnamed
              combobox — the cashier using a screen reader hears "Dine-in" with no idea what it
              controls. */}
          <SelectTrigger aria-label="Order type" className="w-full font-medium">
            {/* Without a render function, Select.Value shows the raw value ("DINE_IN") instead of
             * the label ("Dine-in") — it never reads a SelectItem's children automatically. */}
            <SelectValue>{(v: OrderType) => ORDER_TYPES.find((t) => t.value === v)?.label ?? v}</SelectValue>
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
            className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50"
          >
            <MapPin className="size-4 text-muted-foreground" />
            {tableLabel ? <span className="font-medium">Table {tableLabel}</span> : <span className="text-muted-foreground">Select a table</span>}
          </button>
        )}

        {orderType === "DELIVERY" && (
          <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1">
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={deliveryAddress}
              onChange={(e) => onDeliveryAddressChange(e.target.value)}
              placeholder="Delivery address"
              className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </div>
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
            <CartRow
              key={line.key}
              line={line}
              onQuantityChange={onQuantityChange}
              onRemoveLine={onRemoveLine}
              onNoteChange={onNoteChange}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5 border-t bg-muted/30 p-4 text-sm">
        <Row label="Subtotal" value={totals?.discountedSubtotalPaisa} />
        {!!totals?.serviceChargePaisa && <Row label="Service charge" value={totals.serviceChargePaisa} />}
        <Row label={`Tax (${((totals?.appliedRateBasisPoints ?? 0) / 100).toFixed(0)}%)`} value={totals?.taxPaisa} />
        <div className="mt-2 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/10 px-3.5 py-3 shadow-xs">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total</span>
          <span className="font-heading text-xl font-bold tabular-nums text-primary">
            {formatPkr(totals?.totalPaisa ?? 0)}
          </span>
        </div>
      </div>

      <div className="space-y-2 border-t p-4">
        <Button
          className="w-full"
          size="lg"
          disabled={lines.length === 0 || sending}
          onClick={onSendToKitchen}
        >
          {sending ? "Sending…" : "Send to Kitchen"}
        </Button>
        {canTakePayment && (
          <Button variant="success" className="w-full" size="lg" disabled={lines.length === 0} onClick={onOpenPayment}>
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


/**
 * One line in the cart, with the note the kitchen will read.
 *
 * The note lives here rather than in the options dialog because most items never open one — an
 * item with no sizes and no add-ons is a single tap — and "no sugar" is just as likely on those.
 * Its own component so the open/closed state of the box belongs to the line rather than to a map
 * of keys held by the panel.
 */
export function CartRow({
  line,
  onQuantityChange,
  onRemoveLine,
  onNoteChange,
}: {
  line: CartLine;
  onQuantityChange: (key: string, delta: number) => void;
  onRemoveLine: (key: string) => void;
  onNoteChange: (key: string, notes: string) => void;
}) {
  // Opens on demand so a cart of ten items is not ten text boxes, but stays open for a line that
  // already carries a note — otherwise the note is invisible until someone thinks to look for it.
  const [open, setOpen] = useState(false);
  const showBox = open || !!line.notes;

  return (
    <div className="rounded-xl border border-border/60 bg-background p-3 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-snug">{line.name}</div>
        <button
          onClick={() => onRemoveLine(line.key)}
          aria-label={`Remove ${line.name}`}
          className="-m-1.5 flex shrink-0 size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full border bg-muted/50 p-0.5">
          <button
            onClick={() => onQuantityChange(line.key, -1)}
            aria-label={`One fewer ${line.name}`}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground active:scale-95"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
          <button
            onClick={() => onQuantityChange(line.key, 1)}
            aria-label={`One more ${line.name}`}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={`Note for ${line.name}`}
            title="Note for the kitchen"
            className={`flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted active:scale-95 ${
              line.notes ? "text-warning" : "text-muted-foreground"
            }`}
          >
            <NotebookPen className="h-4 w-4" />
          </button>
          <div className="font-heading text-sm font-semibold tabular-nums">
            {formatPkr(line.unitPricePaisa * line.quantity)}
          </div>
        </div>
      </div>
      {showBox && (
        <Input
          autoFocus={open}
          value={line.notes ?? ""}
          onChange={(e) => onNoteChange(line.key, e.target.value)}
          onBlur={() => setOpen(false)}
          // Matches the server's own limit on the column, so a long note is stopped where it is
          // typed rather than rejected after Send to Kitchen.
          maxLength={280}
          aria-label={`Note for ${line.name}`}
          placeholder="No sugar, extra spicy…"
          className="mt-2 h-8 text-sm"
        />
      )}
    </div>
  );
}
