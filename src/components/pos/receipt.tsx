import { formatPkr, paymentStanding } from "@/lib/money";
import type { OrderBill } from "@/lib/bill";
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
 * read on paper, not a screen. The `print-area` class is what printTicket (src/lib/print-ticket.ts)
 * looks for: it prints this element alone, on a page exactly its length. */
export function Receipt({
  order,
  tenantName,
  branchName,
  logoUrl,
  showLogo = false,
  receiptHeader,
  bill,
  showCredit = false,
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
  /**
   * Present when this is a bill for an unpaid order rather than a receipt. Its figures replace the
   * order's own, which are only a provisional cash-rate estimate until payment — and it carries a
   * total for each way of paying, because tax depends on which one the customer chooses.
   */
  bill?: OrderBill;
  /** Tenant.showReceiptCredit: "ToffeeOS by Krimsols · @krimsols" at the foot. */
  showCredit?: boolean;
}) {
  const subtotal = bill ? bill.subtotalPaisa : (order.subtotalPaisa ?? order.totalPaisa);
  const discountedSubtotal = order.discountedSubtotalPaisa ?? subtotal;
  const discount = bill ? bill.discountPaisa : subtotal - discountedSubtotal;
  const serviceCharge = bill ? bill.serviceChargePaisa : (order.serviceChargePaisa ?? 0);
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
      {bill && <div className="mb-1 text-center text-base font-bold tracking-[0.3em]">BILL</div>}
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
        {/* A voided item was never charged, so it is not on anything the customer is handed. */}
        {order.lines.filter((l) => !l.isVoided).map((l) => (
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
        {bill && bill.deliveryFeePaisa > 0 && (
          <div className="flex justify-between">
            <span>Delivery</span>
            <span className="tabular-nums">{formatPkr(bill.deliveryFeePaisa, { showPaisa: true })}</span>
          </div>
        )}
        {!bill && tax > 0 && (
          <div className="flex justify-between">
            <span>Tax ({taxRatePct}%)</span>
            <span className="tabular-nums">{formatPkr(tax, { showPaisa: true })}</span>
          </div>
        )}
        {/* On the paper itself, receipt and bill alike: a bill with no tax on it has to say why, or it
            reads as a mistake to the customer and as an omission to a tax inspector. */}
        {order.taxExemptReason && <div>Tax exempt: {order.taxExemptReason}</div>}
        {!bill && rounding !== 0 && (
          <div className="flex justify-between">
            <span>Rounding</span>
            <span className="tabular-nums">{formatPkr(rounding, { showPaisa: true })}</span>
          </div>
        )}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      {bill ? (
        <BillTotals bill={bill} />
      ) : (
        <div className="flex justify-between text-base font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatPkr(order.totalPaisa, { showPaisa: true })}</span>
        </div>
      )}
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
            {/* What was handed over and what went back, as recorded at the till. A customer
                checking their change reads this line before any other. */}
            {payments
              .filter((p) => p.tenderedPaisa != null)
              .map((p, i) => (
                <div key={`cash-${i}`}>
                  <div className="flex justify-between">
                    <span>Cash received</span>
                    <span className="tabular-nums">{formatPkr(p.tenderedPaisa as number, { showPaisa: true })}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Change</span>
                    <span className="tabular-nums">{formatPkr(p.changePaisa ?? 0, { showPaisa: true })}</span>
                  </div>
                </div>
              ))}
            {!payments.some((p) => p.tenderedPaisa != null) && standing.state === "PAID" && standing.changePaisa > 0 && (
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
        {!bill && standing.balancePaisa > 0 && (
          <div className="mt-0.5 font-bold">
            Balance due {formatPkr(standing.balancePaisa, { showPaisa: true })}
          </div>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">
        {standing.state === "PAID" ? "Thank you for dining with us!" : "This is not a payment receipt."}
      </div>
      {/* Who made the till, below everything the restaurant says: small, one line, no pitch. */}
      {showCredit && (
        <div className="mt-2 flex items-center justify-center gap-1 text-[0.85em]" data-testid="receipt-credit">
          <span>ToffeeOS by Krimsols ·</span>
          <InstagramGlyph />
          <span>@krimsols</span>
        </div>
      )}
    </div>
  );
}

/**
 * The Instagram glyph, drawn in plain black lines so it prints crisp on a thermal printer. There is
 * no Instagram emoji, and a colour one would print as a grey smudge.
 */
function InstagramGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block size-[1em] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-label="Instagram"
      role="img"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The totals block of a bill: one per way of paying that comes to a different amount.
 *
 * A branch with a single tax rate gets an ordinary TOTAL. A branch on PRA's split gets a block for
 * cash and one for card and the rest, each with its own tax line, so the customer sees what they
 * will actually be charged whichever way they pay — the card figure is lower, which is the point
 * of the lower rate.
 */
function BillTotals({ bill }: { bill: OrderBill }) {
  if (bill.options.length === 1) {
    const [only] = bill.options;
    return (
      <div className="space-y-0.5">
        {only.taxPaisa > 0 && (
          <div className="flex justify-between">
            <span>Tax ({only.taxRatePct}%)</span>
            <span className="tabular-nums">{formatPkr(only.taxPaisa, { showPaisa: true })}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatPkr(only.totalPaisa, { showPaisa: true })}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {bill.options.map((option) => (
        <div key={option.methods.join("-")} className="space-y-0.5">
          <div className="font-bold">If paid by {option.methods.map((m) => METHOD_LABEL[m] ?? m).join(", ")}</div>
          <div className="flex justify-between pl-2">
            <span>Tax ({option.taxRatePct}%)</span>
            <span className="tabular-nums">{formatPkr(option.taxPaisa, { showPaisa: true })}</span>
          </div>
          <div className="flex justify-between pl-2 text-base font-bold">
            <span>TOTAL</span>
            <span className="tabular-nums">{formatPkr(option.totalPaisa, { showPaisa: true })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
