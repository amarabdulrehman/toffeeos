import { formatPkr, paymentStanding } from "@/lib/money";
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
  logoUrl,
  showLogo = false,
  receiptHeader,
}: {
  order: OrderDto;
  tenantName: string;
  branchName: string;
  /** Tenant.logoUrl — a permanent public URL (see uploadTenantLogo in src/server/storage.ts). */
  logoUrl?: string | null;
  /** BranchSettings.showLogoOnReceipt. Off by default so no existing client's receipts change. */
  showLogo?: boolean;
  /** BranchSettings.receiptHeader — address, phone, NTN, printed under the branch name. */
  receiptHeader?: string | null;
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
  const standing = paymentStanding(order.totalPaisa, order.paidPaisa ?? 0);

  return (
    <div id="printable-receipt" className="print-area mx-auto w-[300px] font-mono text-[13px] leading-snug text-black">
      <div className="text-center">
        {showLogo && logoUrl && (
          // Plain <img>, not next/image: this element is printed, and next/image's lazy loading and
          // srcset add nothing on paper while risking an unloaded image at the moment print fires.
          // Height-capped so a large upload can't push the order off a thermal receipt, and
          // grayscale because most receipt printers are single-colour — a colour logo would
          // otherwise dither into mud.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="mx-auto mb-1 max-h-16 w-auto object-contain grayscale"
            // A broken or slow logo must never cost the customer their receipt: hide it and let the
            // name below stand on its own.
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <div className="text-base font-bold">{tenantName}</div>
        <div>{branchName}</div>
        {receiptHeader && (
          // whitespace-pre-line: an address is typed as several lines and has to print that way.
          // break-words stops a long URL or unspaced string from running off the paper.
          <div className="mt-1 whitespace-pre-line break-words">{receiptHeader}</div>
        )}
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
          <div key={l.id}>
            <div className="flex justify-between gap-2">
              <span className="flex-1">
                {l.quantity}× {l.nameSnapshot}
              </span>
              <span className="tabular-nums">{formatPkr(l.lineTotalPaisa, { showPaisa: true })}</span>
            </div>
            {/* What the extra money was for. The line total already includes these, so they are
                listed rather than priced again — a second column of numbers that do not add up to
                the total is worse than none. */}
            {l.modifiers?.map((m) => (
              <div key={m.id} className="pl-3 text-[0.9em]">
                + {m.nameSnapshot}
              </div>
            ))}
            {l.notes && <div className="pl-3 text-[0.9em] italic">— {l.notes}</div>}
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
            {standing.state === "PAID" && standing.changePaisa > 0 && (
              <div className="flex justify-between">
                <span>Change</span>
                <span className="tabular-nums">{formatPkr(standing.changePaisa, { showPaisa: true })}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/*
        Settlement status, stamped.

        A bill handed to a customer and a bill already settled are different documents, and until
        now they printed identically — which is how a table gets asked to pay twice, or walks out
        having never been asked at all.

        Drawn as a ruled box rather than white-on-black: a solid inverted block is the obvious way
        to make this shout, but thermal heads render large black fills unevenly, it burns paper, and
        on a weak printer the text inside can vanish into the fill. A double rule and letter-spaced
        caps read just as loudly and survive a tired printer.
      */}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="border-y-2 border-black py-1.5 text-center">
        <div className="text-base font-bold tracking-[0.25em]">
          {standing.state === "PAID" ? "PAID" : standing.state === "PART_PAID" ? "PART PAID" : "UNPAID"}
        </div>
        {standing.balancePaisa > 0 && (
          <div className="mt-0.5 font-bold">
            Balance due {formatPkr(standing.balancePaisa, { showPaisa: true })}
          </div>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">
        {standing.state === "PAID" ? "Thank you for dining with us!" : "This is not a payment receipt."}
      </div>
    </div>
  );
}
