"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, LockKeyhole, TriangleAlert, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr, paisaToRupees, rupeesToPaisa } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/daily-sales";

interface DrawerDay {
  id: string | null;
  businessDate: string;
  branchId: string;
  branchName: string;
  isOpen: boolean;
  openingBalancePaisa: number | null;
  openedByName: string | null;
  openedAt: string | null;
  cashSalesPaisa: number;
  cashExpensesPaisa: number;
  cashRefundsPaisa: number;
  expectedClosingPaisa: number | null;
  closingCountedPaisa: number | null;
  closedByName: string | null;
  closedAt: string | null;
  variancePaisa: number | null;
  correctedByName: string | null;
  correctedAt: string | null;
  note: string | null;
  /** The drawer opened with no sale this day — who, when, why. Absent from the history list. */
  noSales?: { at: string; byName: string | null; reason: string }[];
  /** The day's takings by every way of paying. Absent from the history list. */
  takings?: {
    byMethod: { method: string; amountPaisa: number }[];
    refundsByMethod: { method: string; amountPaisa: number }[];
    complimentary: { itemCount: number; valuePaisa: number };
  };
}

/**
 * Every way of paying side by side, for closing up. Beside the drawer, never part of it: only the
 * cash is in the drawer, and the card figure is the one to check against the card machine's slip.
 */
function TakingsCard({ takings }: { takings: NonNullable<DrawerDay["takings"]> }) {
  const taken = takings.byMethod.reduce((a, r) => a + r.amountPaisa, 0);
  const refunded = new Map(takings.refundsByMethod.map((r) => [r.method, r.amountPaisa]));
  const methods = [...new Set([...takings.byMethod.map((r) => r.method), ...takings.refundsByMethod.map((r) => r.method)])];
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="font-heading">Today&apos;s takings by payment method</CardTitle>
        <p className="text-sm text-muted-foreground">
          Only cash is in the drawer. Check the card total against the card machine&apos;s end-of-day slip.
        </p>
      </CardHeader>
      <CardContent>
        {methods.length === 0 && takings.complimentary.valuePaisa === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing taken yet today.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="takings-by-method">
            {methods.map((m) => {
              const amount = takings.byMethod.find((r) => r.method === m)?.amountPaisa ?? 0;
              const back = refunded.get(m) ?? 0;
              return (
                <Figure
                  key={m}
                  label={METHOD_LABEL[m] ?? m}
                  value={formatPkr(amount, { showPaisa: true })}
                  hint={back > 0 ? `${formatPkr(back, { showPaisa: true })} refunded` : undefined}
                />
              );
            })}
            <Figure label="Total taken" value={formatPkr(taken, { showPaisa: true })} strong />
            {takings.complimentary.valuePaisa > 0 && (
              <Figure
                label="Complimentary"
                value={formatPkr(takings.complimentary.valuePaisa, { showPaisa: true })}
                hint={`${takings.complimentary.itemCount} item${takings.complimentary.itemCount === 1 ? "" : "s"}, not charged`}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Over, short, or exact — the three things a variance can be, and the only number anyone acts on. */
function VarianceBadge({ paisa }: { paisa: number }) {
  if (paisa === 0) return <Badge variant="success">Balanced</Badge>;
  const over = paisa > 0;
  return (
    <Badge variant={over ? "warning" : "destructive"}>
      {over ? "Over by " : "Short by "}
      {formatPkr(Math.abs(paisa), { showPaisa: true })}
    </Badge>
  );
}

function Figure({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 tabular-nums ${strong ? "text-xl font-semibold" : "font-medium"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function CashDrawerView({ canClose, canCorrect }: { canClose: boolean; canCorrect: boolean }) {
  const [today, setToday] = useState<DrawerDay | null>(null);
  const [history, setHistory] = useState<DrawerDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [amountRupees, setAmountRupees] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dayRes, histRes] = await Promise.all([
        fetch("/api/cash-drawer"),
        fetch("/api/cash-drawer?history=true"),
      ]);
      if (!dayRes.ok || !histRes.ok) {
        toast.error("Could not load the cash drawer.");
        return;
      }
      setToday((await dayRes.json()).day);
      setHistory((await histRes.json()).days);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(kind: "open" | "close") {
    const paisa = Math.max(0, rupeesToPaisa(parseFloat(amountRupees) || 0));
    setSaving(true);
    try {
      const res = await fetch("/api/cash-drawer", {
        method: kind === "open" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "open"
            ? { openingBalancePaisa: paisa, note: note || null }
            : { closingCountedPaisa: paisa, note: note || null }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save.");
        return;
      }
      if (kind === "open") {
        toast.success(`Drawer opened with ${formatPkr(paisa, { showPaisa: true })}.`);
      } else {
        const v: number = data.day.variancePaisa;
        const verb = data.isCorrection ? "corrected" : "closed";
        // Silence on a discrepancy is how it gets ignored, so the toast names it either way.
        if (v === 0) toast.success(`Day ${verb} — the drawer balanced exactly.`);
        else
          toast.warning(
            `Day ${verb} — ${v > 0 ? "over" : "short"} by ${formatPkr(Math.abs(v), { showPaisa: true })}.`
          );
      }
      setOpenDialog(false);
      setCloseDialog(false);
      setCorrecting(false);
      setNote("");
      setAmountRupees("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!today) return null;

  const notOpenedYet = today.openingBalancePaisa == null;
  const closed = today.closedAt != null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Cash drawer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {today.branchName} · {today.businessDate}
        </p>
      </div>

      <Card className="shadow-md">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 font-heading">
            <Wallet className="size-4" />
            Today
            {closed ? (
              <Badge variant="outline">{today.correctedAt ? "Closed · corrected" : "Closed"}</Badge>
            ) : notOpenedYet ? (
              <Badge variant="outline">Not opened</Badge>
            ) : (
              <Badge variant="info">Open</Badge>
            )}
          </CardTitle>
          {notOpenedYet ? (
            <Button
              size="sm"
              onClick={() => {
                setAmountRupees("");
                setOpenDialog(true);
              }}
            >
              <Banknote className="size-4" />
              Open the drawer
            </Button>
          ) : !closed ? (
            canClose && (
              <Button
                size="sm"
                onClick={() => {
                  // Prefilled with what should be there — the counter still types their own figure,
                  // but starting from a blank box invites a lazy copy of the expected number.
                  setAmountRupees(String(paisaToRupees(today.expectedClosingPaisa ?? 0)));
                  setCorrecting(false);
                  setCloseDialog(true);
                }}
              >
                <LockKeyhole className="size-4" />
                Close the day
              </Button>
            )
          ) : (
            // A closed day can only be corrected, never re-closed the ordinary way — restricted to
            // Owner/Branch Manager (pos.cashDrawer.correctClose), not the cashier who closed it.
            canCorrect && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAmountRupees(String(paisaToRupees(today.closingCountedPaisa ?? 0)));
                  setNote("");
                  setCorrecting(true);
                  setCloseDialog(true);
                }}
              >
                <LockKeyhole className="size-4" />
                Correct the count
              </Button>
            )
          )}
        </CardHeader>
        <CardContent>
          {notOpenedYet && today.cashSalesPaisa > 0 && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {formatPkr(today.cashSalesPaisa)} of cash has already gone through the till today with no
              opening float recorded. Open the drawer with the amount that was actually in it this
              morning.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Figure
              label="Opening float"
              value={today.openingBalancePaisa == null ? "—" : formatPkr(today.openingBalancePaisa, { showPaisa: true })}
              hint={today.openedByName ? `by ${today.openedByName}` : undefined}
            />
            <Figure label="Cash sales" value={formatPkr(today.cashSalesPaisa, { showPaisa: true })} hint="cash only" />
            <Figure
              label="Cash expenses"
              value={today.cashExpensesPaisa > 0 ? `-${formatPkr(today.cashExpensesPaisa, { showPaisa: true })}` : "—"}
              hint="paid from the till"
            />
            {/* Shown as its own figure rather than folded into expenses: a manager counting a short
                drawer needs to see refunds separately, because that is the number they can go and
                check against the orders. */}
            <Figure
              label="Cash refunds"
              value={today.cashRefundsPaisa > 0 ? `-${formatPkr(today.cashRefundsPaisa, { showPaisa: true })}` : "—"}
              hint="given back to customers"
            />
            <Figure
              label="Expected in drawer"
              value={today.expectedClosingPaisa == null ? "—" : formatPkr(today.expectedClosingPaisa, { showPaisa: true })}
              strong
            />
            <Figure
              label="Counted"
              value={today.closingCountedPaisa == null ? "—" : formatPkr(today.closingCountedPaisa, { showPaisa: true })}
              hint={
                today.correctedByName
                  ? `closed by ${today.closedByName}, corrected by ${today.correctedByName}`
                  : today.closedByName
                    ? `by ${today.closedByName}`
                    : undefined
              }
              strong
            />
          </div>

          {today.variancePaisa != null && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border bg-muted/20 px-3.5 py-3">
              <span className="text-sm text-muted-foreground">Difference</span>
              <VarianceBadge paisa={today.variancePaisa} />
              {today.note && <span className="text-sm text-muted-foreground">· {today.note}</span>}
            </div>
          )}

          {/* Next to the count, because an opening with no sale is the first thing to rule out when
              the drawer comes up short. */}
          {today.noSales && today.noSales.length > 0 && (
            <div className="mt-5 rounded-xl border bg-muted/20 px-3.5 py-3">
              <div className="text-sm font-medium">
                Opened with no sale: {today.noSales.length} time{today.noSales.length === 1 ? "" : "s"}
              </div>
              <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
                {today.noSales.map((n) => (
                  <li key={n.at}>
                    {new Date(n.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {n.byName ?? "Unknown"} ·{" "}
                    {n.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {today.takings && <TakingsCard takings={today.takings} />}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="font-heading">Recent days</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No days recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Cash sales</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead>Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((d) => (
                    <TableRow key={d.businessDate}>
                      <TableCell className="font-medium whitespace-nowrap">{d.businessDate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.openingBalancePaisa == null ? "—" : formatPkr(d.openingBalancePaisa)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPkr(d.cashSalesPaisa)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {d.cashExpensesPaisa > 0 ? `-${formatPkr(d.cashExpensesPaisa)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.expectedClosingPaisa == null ? "—" : formatPkr(d.expectedClosingPaisa)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {d.closingCountedPaisa == null ? "—" : formatPkr(d.closingCountedPaisa)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {d.variancePaisa == null ? (
                            <Badge variant="outline">Open</Badge>
                          ) : (
                            <VarianceBadge paisa={d.variancePaisa} />
                          )}
                          {d.correctedByName && (
                            <span className="text-xs text-muted-foreground">corrected by {d.correctedByName}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openDialog} onOpenChange={(o) => !o && setOpenDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">Open the drawer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              How much cash is in the drawer right now, before any sales. This is the float the day
              gets reconciled against.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="opening">Opening float (Rs)</Label>
              <Input
                id="opening"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                autoFocus
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="open-note">Note (optional)</Label>
              <Textarea id="open-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => submit("open")} disabled={saving || !(parseFloat(amountRupees) >= 0)}>
              {saving ? "Opening…" : "Open the drawer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialog} onOpenChange={(o) => !o && setCloseDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">{correcting ? "Correct the count" : "Close the day"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {correcting ? (
                <>
                  This day was already closed
                  {today.closedByName ? ` by ${today.closedByName}` : ""}. Entering a new count replaces
                  it — the original closer and close time stay on record, and this correction is
                  audit-logged with who made it and what the count changed from.
                </>
              ) : (
                "Count what is physically in the drawer and enter it. Anything left over or missing is recorded as a difference — it is not adjusted away."
              )}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="counted">Counted in drawer (Rs)</Label>
              <Input
                id="counted"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                autoFocus
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Expected: {formatPkr(today.expectedClosingPaisa ?? 0, { showPaisa: true })}
                {correcting && ` · Previously counted: ${formatPkr(today.closingCountedPaisa ?? 0, { showPaisa: true })}`}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="close-note">{correcting ? "Reason for the correction" : "Note (optional)"}</Label>
              <Textarea
                id="close-note"
                rows={2}
                placeholder={correcting ? "e.g. Typed Rs 45,000 instead of Rs 4,500" : "e.g. Rs 500 short — cashier float taken for change"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => submit("close")} disabled={saving || !(parseFloat(amountRupees) >= 0)}>
              {saving ? "Saving…" : correcting ? "Save correction" : "Close the day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
