"use client";

import { useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";
import { METHOD_LABEL, ORDER_TYPE_LABEL, shortDay, type DayReport, type PeriodReport, type SalesTotals } from "@/lib/daily-sales";
import { printTicket } from "@/lib/print-ticket";
import { TicketPreview } from "@/components/print/ticket-preview";

export type ClosingReport =
  | { kind: "day"; data: DayReport; title: string }
  | { kind: "period"; data: PeriodReport; title: string; periodLabel: string };

/**
 * The end-of-day (or week, or month) summary on paper — what the owner files, or checks the drawer
 * against. Printed like the bill and the kitchen ticket, by printTicket (src/lib/print-ticket.ts),
 * on the receipt printer's paper width.
 */
export function ClosingDialog({
  open,
  onClose,
  tenantName,
  scopeLabel,
  report,
}: {
  open: boolean;
  onClose: () => void;
  tenantName: string;
  scopeLabel: string;
  report: ClosingReport;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">{report.kind === "day" ? "Day summary" : "Closing summary"}</DialogTitle>
        </DialogHeader>
        <TicketPreview kind="receipt">
          {open && <ClosingSlip tenantName={tenantName} scopeLabel={scopeLabel} report={report} />}
        </TicketPreview>
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

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-bold" : ""}`}>
      <span className="min-w-0 flex-1">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-2 border-t border-dashed border-black" />;
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="mb-0.5 font-bold">{children}</div>;
}

function TotalsBlock({ t }: { t: SalesTotals }) {
  return (
    <>
      <div className="space-y-0.5">
        <Row label="Orders" value={t.orderCount} />
        <Row label="Gross sales" value={formatPkr(t.grossPaisa)} />
        <Row label="Refunds" value={t.refundedPaisa > 0 ? `-${formatPkr(t.refundedPaisa)}` : formatPkr(0)} />
        <Row label="NET SALES" value={formatPkr(t.netPaisa)} strong />
        <Row label="Average order" value={formatPkr(t.averageOrderPaisa)} />
      </div>
      <div className="mt-1 space-y-0.5 text-[0.92em]">
        <Row label="Discounts given" value={formatPkr(t.discountPaisa)} />
        <Row label="Tax collected" value={formatPkr(t.taxPaisa)} />
        {t.serviceChargePaisa > 0 && <Row label="Service charge" value={formatPkr(t.serviceChargePaisa)} />}
      </div>
      <Rule />
      <Heading>PAYMENTS</Heading>
      <div className="space-y-0.5">
        {t.byPaymentMethod.length === 0 && <div>None</div>}
        {t.byPaymentMethod.map((p) => (
          <Row key={p.method} label={METHOD_LABEL[p.method] ?? p.method} value={formatPkr(p.amountPaisa)} />
        ))}
      </div>
      {t.byOrderType.length > 0 && (
        <>
          <Rule />
          <Heading>ORDER TYPES</Heading>
          <div className="space-y-0.5">
            {t.byOrderType.map((o) => (
              <Row
                key={o.type}
                label={`${ORDER_TYPE_LABEL[o.type] ?? o.type} (${o.orderCount})`}
                value={formatPkr(o.grossPaisa)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ClosingSlip({ tenantName, scopeLabel, report }: { tenantName: string; scopeLabel: string; report: ClosingReport }) {
  // Fixed when the slip opens, so the printed time is when it was printed, not when it re-rendered.
  const [printedAt] = useState(() => new Date().toLocaleString());

  return (
    <div className="print-area mx-auto w-[300px] font-mono text-[13px] leading-snug text-black">
      <div className="text-center">
        <div className="text-base font-bold">{tenantName}</div>
        <div>{scopeLabel}</div>
      </div>
      <Rule />
      <div className="text-center font-bold tracking-[0.15em]">{report.title}</div>
      <div className="text-center">{report.kind === "day" ? shortDay(report.data.day, true) : report.periodLabel}</div>
      <div className="text-center text-[0.9em]">Printed {printedAt}</div>
      <Rule />

      <TotalsBlock t={report.data.totals} />

      {report.kind === "day" && (
        <>
          {(report.data.voids.count > 0 || report.data.itemVoids.count > 0 || report.data.openOrders.count > 0) && (
            <>
              <Rule />
              {report.data.voids.count > 0 && (
                <Row label={`Voided orders (${report.data.voids.count})`} value={formatPkr(report.data.voids.valuePaisa)} />
              )}
              {report.data.itemVoids.count > 0 && (
                <Row label={`Voided items (${report.data.itemVoids.count})`} value={formatPkr(report.data.itemVoids.valuePaisa)} />
              )}
              {report.data.openOrders.count > 0 && (
                <Row label={`Still open (${report.data.openOrders.count})`} value={formatPkr(report.data.openOrders.valuePaisa)} />
              )}
            </>
          )}
          {report.data.topItems.length > 0 && (
            <>
              <Rule />
              <Heading>BEST SELLERS</Heading>
              <div className="space-y-0.5">
                {report.data.topItems.slice(0, 5).map((i) => (
                  <Row key={i.name} label={`${i.quantity}× ${i.name}`} value={formatPkr(i.revenuePaisa)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {report.kind === "period" && (
        <>
          <Rule />
          <Heading>DAY BY DAY</Heading>
          <div className="space-y-0.5">
            {report.data.days.map((d) => (
              <Row key={d.day} label={`${shortDay(d.day)} (${d.orderCount})`} value={formatPkr(d.netPaisa)} />
            ))}
          </div>
        </>
      )}

      <Rule />
      <div className="mt-4">Checked by: ____________________</div>
    </div>
  );
}
