import { formatPkr } from "@/lib/money";
import type { OrderDto } from "./types";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

/** Pure, print-focused layout — deliberately narrow (thermal-receipt-paper proportions) and
 * plain, not styled to match the rest of the app, since this is the one piece of UI meant to be
 * read on paper, not a screen. Rendered inside ReceiptDialog, which is what actually makes only
 * this element show up when the browser's print dialog fires — see the #printable-receipt rule
 * in globals.css. */
export function Receipt({
  order,
  tenantName,
  branchName,
}: {
  order: OrderDto;
  tenantName: string;
  branchName: string;
}) {
  const subtotal = order.subtotalPaisa ?? order.totalPaisa;
  const discountedSubtotal = order.discountedSubtotalPaisa ?? subtotal;
  const discount = subtotal - discountedSubtotal;
  const serviceCharge = order.serviceChargePaisa ?? 0;
  const tax = order.taxPaisa ?? 0;
  const rounding = order.roundingAdjustmentPaisa ?? 0;
  const taxableBase = discountedSubtotal + serviceCharge;
  const taxRatePct = taxableBase > 0 ? Math.round((tax / taxableBase) * 100) : 0;
  const payments = order.payments ?? [];

  return (
    <div id="printable-receipt" className="print-area mx-auto w-[300px] font-mono text-[13px] leading-snug text-black">
      <div className="text-center">
        <div className="text-base font-bold">{tenantName}</div>
        <div>{branchName}</div>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between">
        <span>Order #{order.orderNumber}</span>
        <span>{new Date(order.createdAt).toLocaleString()}</span>
      </div>
      <div>
        {order.type.replace(/_/g, " ")}
        {order.table ? ` · Table ${order.table.label}` : ""}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="space-y-0.5">
        {order.lines.map((l) => (
          <div key={l.id} className="flex justify-between gap-2">
            <span className="flex-1">
              {l.quantity}× {l.nameSnapshot}
            </span>
            <span className="tabular-nums">{formatPkr(l.lineTotalPaisa, { showPaisa: true })}</span>
          </div>
        ))}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatPkr(subtotal, { showPaisa: true })}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span className="tabular-nums">-{formatPkr(discount, { showPaisa: true })}</span>
          </div>
        )}
        {serviceCharge > 0 && (
          <div className="flex justify-between">
            <span>Service charge</span>
            <span className="tabular-nums">{formatPkr(serviceCharge, { showPaisa: true })}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex justify-between">
            <span>Tax ({taxRatePct}%)</span>
            <span className="tabular-nums">{formatPkr(tax, { showPaisa: true })}</span>
          </div>
        )}
        {rounding !== 0 && (
          <div className="flex justify-between">
            <span>Rounding</span>
            <span className="tabular-nums">{formatPkr(rounding, { showPaisa: true })}</span>
          </div>
        )}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between text-base font-bold">
        <span>TOTAL</span>
        <span className="tabular-nums">{formatPkr(order.totalPaisa, { showPaisa: true })}</span>
      </div>
      {payments.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <div className="space-y-0.5">
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>{METHOD_LABEL[p.method] ?? p.method}</span>
                <span className="tabular-nums">{formatPkr(p.amountPaisa, { showPaisa: true })}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">Thank you for dining with us!</div>
    </div>
  );
}
