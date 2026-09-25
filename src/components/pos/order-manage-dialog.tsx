"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Gift, Merge, Receipt, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import type { FloorDto, OrderDto } from "./types";

export interface ManagePermissions {
  canVoidLine: boolean;
  canChangeType: boolean;
  canMerge: boolean;
  canTaxExempt: boolean;
  /** Spend the customer's loyalty points on the bill — whoever takes payment. */
  canRedeemPoints?: boolean;
}

/** True when the person can do anything in this dialog at all — otherwise the button isn't shown. */
export function canManageAnything(p: ManagePermissions): boolean {
  return p.canVoidLine || p.canChangeType || p.canMerge || p.canTaxExempt || !!p.canRedeemPoints;
}

async function send(url: string, method: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "That didn't work.");
      return false;
    }
    return true;
  } catch {
    toast.error("Could not reach the server. Check the connection.");
    return false;
  }
}

/**
 * Changing an order after it was punched: take an item off, switch dine-in and takeaway, merge in
 * another table, or sell it without tax. Each section shows only if the person's role allows it.
 *
 * Every change is made by the server, which prices the order again, and this re-reads the order
 * afterwards rather than adjusting its own copy — the figures shown are always the server's.
 * Needs a connection: none of these can be queued offline, since each depends on the order as it
 * stands right now.
 */
export function OrderManageDialog({
  orderId,
  permissions,
  onClose,
  onChanged,
}: {
  /** Null closes the dialog. */
  orderId: string | null;
  permissions: ManagePermissions;
  onClose: () => void;
  /** After any change, so the queue and the table panel pick up the new order. */
  onChanged: (order: OrderDto) => void;
}) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!orderId) return null;
    const res = await fetch(`/api/orders/${orderId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not load the order.");
      return null;
    }
    setOrder(data.order as OrderDto);
    return data.order as OrderDto;
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    // The same indirection tables-dialog.tsx uses: reload sets state once its fetch resolves, and
    // calling it straight from the effect body trips react-hooks/set-state-in-effect.
    (async () => {
      await reload();
    })();
  }, [orderId, reload]);

  async function act(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    const ok = await send(url, method, body);
    if (ok) {
      toast.success(done);
      const fresh = await reload();
      if (fresh) onChanged(fresh);
    }
    setBusy(false);
    return ok;
  }

  const current = order && order.id === orderId ? order : null;

  return (
    <Dialog open={!!orderId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {current ? `Order #${current.orderNumber}${current.table ? ` · Table ${current.table.label}` : ""}` : "Order"}
          </DialogTitle>
        </DialogHeader>
        {!current ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            <ItemsSection order={current} canVoid={permissions.canVoidLine} busy={busy} act={act} />
            {permissions.canChangeType && (current.type === "DINE_IN" || current.type === "TAKEAWAY") && (
              <TypeSection order={current} busy={busy} act={act} />
            )}
            {permissions.canMerge && current.type === "DINE_IN" && <MergeSection order={current} busy={busy} act={act} />}
            {permissions.canTaxExempt && <TaxSection order={current} busy={busy} act={act} />}
            {permissions.canRedeemPoints && <PointsSection order={current} busy={busy} act={act} />}
            <div className="flex items-center justify-between border-t pt-3 font-heading font-semibold">
              <span>Total</span>
              <span className="tabular-nums" data-testid="manage-total">
                {formatPkr(current.totalPaisa)}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Act = (url: string, method: string, body: unknown, done: string) => Promise<boolean>;

function Section({ icon: Icon, title, children }: { icon: typeof Ban; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function ItemsSection({ order, canVoid, busy, act }: { order: OrderDto; canVoid: boolean; busy: boolean; act: Act }) {
  const [voiding, setVoiding] = useState<{ lineId: string; quantity: number; max: number; reason: string } | null>(null);
  const live = order.lines.filter((l) => !l.isVoided);

  return (
    <Section icon={Ban} title="Items">
      <ul className="space-y-1.5 text-sm">
        {order.lines.map((l) => (
          <li key={l.id} className={l.isVoided ? "text-muted-foreground line-through" : ""}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                {l.quantity}× {l.nameSnapshot}
                {l.isVoided && <span className="ml-1.5 text-xs no-underline">(voided)</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums">{formatPkr(l.lineTotalPaisa)}</span>
                {canVoid && !l.isVoided && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={busy || live.length === 1 && l.quantity === 1}
                    title={live.length === 1 && l.quantity === 1 ? "The last item — void the whole order instead" : undefined}
                    onClick={() => setVoiding({ lineId: l.id, quantity: 1, max: l.quantity, reason: "" })}
                    aria-label={`Void ${l.nameSnapshot}`}
                  >
                    Void
                  </Button>
                )}
              </span>
            </div>
            {voiding?.lineId === l.id && (
              <div className="mt-2 space-y-2 rounded-lg border bg-muted/40 p-3 no-underline">
                {voiding.max > 1 && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="void-qty" className="text-xs">
                      How many
                    </Label>
                    <Input
                      id="void-qty"
                      type="number"
                      min={1}
                      max={voiding.max}
                      value={voiding.quantity}
                      onChange={(e) =>
                        setVoiding({ ...voiding, quantity: Math.max(1, Math.min(voiding.max, Number(e.target.value) || 1)) })
                      }
                      className="h-9 w-20"
                    />
                    <span className="text-xs text-muted-foreground">of {voiding.max}</span>
                  </div>
                )}
                <Input
                  placeholder="Why? e.g. customer changed their mind"
                  aria-label="Reason for voiding"
                  value={voiding.reason}
                  onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setVoiding(null)}>
                    Keep it
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy || voiding.reason.trim().length < 2}
                    onClick={async () => {
                      const ok = await act(
                        `/api/orders/${order.id}/lines/${l.id}/void`,
                        "POST",
                        { quantity: voiding.quantity, reason: voiding.reason },
                        `${voiding.quantity}× ${l.nameSnapshot} voided`
                      );
                      if (ok) setVoiding(null);
                    }}
                  >
                    {voiding.quantity > 1 ? `Yes, void ${voiding.quantity}` : "Yes, void it"}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function useTables(enabled: boolean) {
  const [floors, setFloors] = useState<FloorDto[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/tables")
      .then((r) => r.json())
      .then((d) => !cancelled && setFloors(d.floors ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return floors;
}

function TypeSection({ order, busy, act }: { order: OrderDto; busy: boolean; act: Act }) {
  const isDineIn = order.type === "DINE_IN";
  const floors = useTables(!isDineIn);
  const free = floors.flatMap((f) => f.tables.filter((t) => t.status === "AVAILABLE"));
  const [tableId, setTableId] = useState<string>("");

  return (
    <Section icon={Repeat} title="Dine-in or takeaway">
      {isDineIn ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>Eating in{order.table ? ` at table ${order.table.label}` : ""}.</span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => act(`/api/orders/${order.id}/type`, "POST", { type: "TAKEAWAY" }, "Changed to takeaway — the table is free")}
          >
            Make it takeaway
          </Button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <span>Takeaway. Sitting down after all?</span>
          <div className="flex gap-2">
            <Select value={tableId} onValueChange={(v) => setTableId(v ?? "")}>
              <SelectTrigger className="flex-1" aria-label="Table">
                <SelectValue>{(v: string) => (v ? `Table ${free.find((t) => t.id === v)?.label ?? ""}` : "Pick a free table")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {free.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    Table {t.label} · {t.seats} seats
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={busy || !tableId}
              onClick={() => act(`/api/orders/${order.id}/type`, "POST", { type: "DINE_IN", tableId }, "Changed to dine-in")}
            >
              Seat them
            </Button>
          </div>
          {free.length === 0 && floors.length > 0 && <p className="text-xs text-muted-foreground">No table is free right now.</p>}
        </div>
      )}
    </Section>
  );
}

function MergeSection({ order, busy, act }: { order: OrderDto; busy: boolean; act: Act }) {
  const [others, setOthers] = useState<OrderDto[]>([]);
  const [sourceId, setSourceId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/orders")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const open = ((d.orders ?? []) as OrderDto[]).filter(
          (o) => o.id !== order.id && o.type === "DINE_IN" && o.tableId && !["PAID", "VOIDED", "CANCELLED"].includes(o.status)
        );
        setOthers(open);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const label = (o: OrderDto) => `Table ${o.table?.label ?? "?"} · #${o.orderNumber} · ${formatPkr(o.totalPaisa)}`;

  return (
    <Section icon={Merge} title="Merge another table into this bill">
      {others.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other table has an open order.</p>
      ) : (
        <div className="flex gap-2">
          <Select value={sourceId} onValueChange={(v) => setSourceId(v ?? "")}>
            <SelectTrigger className="flex-1" aria-label="Table to merge in">
              <SelectValue>{(v: string) => {
                const o = others.find((x) => x.id === v);
                return o ? label(o) : "Pick a table";
              }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {others.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {label(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={busy || !sourceId}
            onClick={async () => {
              const from = others.find((o) => o.id === sourceId);
              const ok = await act(
                `/api/orders/${order.id}/merge`,
                "POST",
                { sourceOrderId: sourceId },
                `Table ${from?.table?.label ?? ""} merged into this bill`
              );
              if (ok) {
                setOthers((prev) => prev.filter((o) => o.id !== sourceId));
                setSourceId("");
              }
            }}
          >
            Merge
          </Button>
        </div>
      )}
    </Section>
  );
}

function TaxSection({ order, busy, act }: { order: OrderDto; busy: boolean; act: Act }) {
  const [reason, setReason] = useState("");

  return (
    <Section icon={Receipt} title="Tax">
      {order.taxExemptReason ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>
            Tax exempt: <span className="font-medium">{order.taxExemptReason}</span>
          </span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => act(`/api/orders/${order.id}/tax-exemption`, "DELETE", undefined, "Tax will be charged again")}
          >
            Charge tax
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="Reason, e.g. diplomatic mission (ref. 1234)"
            aria-label="Reason for tax exemption"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              const ok = await act(`/api/orders/${order.id}/tax-exemption`, "PUT", { reason }, "No tax on this order");
              if (ok) setReason("");
            }}
          >
            Make tax exempt
          </Button>
        </div>
      )}
    </Section>
  );
}

/**
 * Spending the customer's loyalty points as money off this bill. Shown only when the scheme is on;
 * needs the customer on the order, because the points are theirs.
 */
function PointsSection({ order, busy, act }: { order: OrderDto; busy: boolean; act: Act }) {
  const [program, setProgram] = useState<{ isEnabled: boolean; paisaPerPoint: number } | null>(null);
  const [points, setPoints] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/loyalty")
      .then((r) => r.json())
      .then((d) => !cancelled && d.program && setProgram(d.program))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!program?.isEnabled) return null;
  const spent = (order.discounts ?? []).find((d) => d.loyaltyPointsRedeemed);
  const customer = order.customer;
  const subtotal = order.lines.filter((l) => !l.isVoided).reduce((s, l) => s + l.lineTotalPaisa, 0);
  const most = customer ? Math.min(customer.loyaltyPoints, Math.floor(subtotal / program.paisaPerPoint)) : 0;
  const wanted = Number(points) || 0;

  return (
    <Section icon={Gift} title="Loyalty points">
      {spent ? (
        <p className="text-sm">
          {spent.loyaltyPointsRedeemed} points used — {formatPkr(spent.value)} off.
        </p>
      ) : !customer ? (
        <p className="text-sm text-muted-foreground">No customer on this order, so there are no points to use.</p>
      ) : (order.discounts ?? []).length > 0 ? (
        <p className="text-sm text-muted-foreground">This bill already has a discount, so points can&apos;t be added on top.</p>
      ) : customer.loyaltyPoints <= 0 ? (
        <p className="text-sm text-muted-foreground">{customer.name ?? "This customer"} has no points yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            {customer.name ?? "This customer"} has <span className="font-semibold">{customer.loyaltyPoints}</span> points, worth{" "}
            {formatPkr(customer.loyaltyPoints * program.paisaPerPoint)}.
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={most}
              placeholder={`Up to ${most}`}
              aria-label="Points to use"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || wanted < 1 || wanted > most}
              onClick={async () => {
                const ok = await act(
                  `/api/orders/${order.id}/redeem-points`,
                  "POST",
                  { points: wanted },
                  `${wanted} points used — ${formatPkr(wanted * program.paisaPerPoint)} off`
                );
                if (ok) setPoints("");
              }}
            >
              Use {wanted > 0 ? `${wanted} points (${formatPkr(wanted * program.paisaPerPoint)} off)` : "points"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
