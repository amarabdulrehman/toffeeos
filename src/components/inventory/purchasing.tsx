"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPkr } from "@/lib/money";

interface Location {
  id: string;
  name: string;
}
interface Item {
  id: string;
  name: string;
  unitOfMeasure: string;
}
interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
}
interface PoLine {
  id: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitCostPaisa: number;
  receivedQuantity: number | null;
}
interface PurchaseOrder {
  id: string;
  number: number;
  status: "DRAFT" | "APPROVED" | "RECEIVED" | "CANCELLED";
  supplierName: string;
  notes: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  receivedByName: string | null;
  createdAt: string;
  totalPaisa: number;
  lines: PoLine[];
}

const STATUS_BADGE: Record<PurchaseOrder["status"], "outline" | "info" | "success" | "secondary"> = {
  DRAFT: "outline",
  APPROVED: "info",
  RECEIVED: "success",
  CANCELLED: "secondary",
};
const STATUS_TEXT: Record<PurchaseOrder["status"], string> = {
  DRAFT: "Waiting for approval",
  APPROVED: "Approved — waiting for delivery",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

async function send(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error((data as { error?: string }).error ?? "That didn't work.");
    return { ok: res.ok, data };
  } catch {
    toast.error("Could not reach the server.");
    return { ok: false, data: {} };
  }
}

/** Asks why, in the app's own dialog, and hands the reason to onConfirm. Closing it does nothing. */
function ReasonDialog({
  title,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Why?" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || reason.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim());
              setBusy(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useList<T>(url: string, key: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      setRows(res.ok ? ((data as Record<string, T[]>)[key] ?? []) : []);
    } catch {
      setRows([]);
    }
  }, [url, key]);
  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);
  return { rows, load };
}

// ---------------------------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------------------------

/**
 * Stock ordered from a supplier: draft, approve, receive. Each button shows only to someone whose
 * role allows that step, so in a café where one person does it all it reads as one flow, and in one
 * where ordering and approving are split, each sees their own part.
 */
export function PurchaseOrdersTab({
  locations,
  items,
  canCreate,
  canApprove,
  canReceive,
  onReceived,
}: {
  locations: Location[];
  items: Item[];
  canCreate: boolean;
  canApprove: boolean;
  canReceive: boolean;
  /** Stock levels changed — the stock report should reload. */
  onReceived: () => void;
}) {
  const { rows: orders, load } = useList<PurchaseOrder>("/api/inventory/purchase-orders", "purchaseOrders");
  const { rows: suppliers } = useList<Supplier>("/api/inventory/suppliers", "suppliers");
  const [drafting, setDrafting] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  async function step(po: PurchaseOrder, action: "approve" | "cancel") {
    const { ok } = await send(`/api/inventory/purchase-orders/${po.id}/${action}`);
    if (ok) {
      toast.success(action === "approve" ? `PO #${po.number} approved.` : `PO #${po.number} cancelled.`);
      await load();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="font-heading">Purchase orders</CardTitle>
          <CardDescription>Order from a supplier, approve it, then receive it into stock when it arrives</CardDescription>
        </div>
        {canCreate && (
          <Button onClick={() => setDrafting(true)} disabled={!suppliers || suppliers.filter((s) => s.isActive).length === 0}
            title={suppliers && suppliers.filter((s) => s.isActive).length === 0 ? "Add a supplier first" : undefined}>
            <Plus className="size-4" />
            New purchase order
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {orders === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {orders?.length === 0 && <p className="text-sm text-muted-foreground">No purchase orders yet.</p>}
        {orders?.map((po) => (
          <div key={po.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-heading font-semibold">
                PO #{po.number} · {po.supplierName}
                <span className="ml-2 font-sans text-sm font-normal tabular-nums text-muted-foreground">{formatPkr(po.totalPaisa)}</span>
              </div>
              <Badge variant={STATUS_BADGE[po.status]}>{STATUS_TEXT[po.status]}</Badge>
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
              {po.lines.map((l) => (
                <li key={l.id}>
                  {l.quantity} {l.unit} {l.itemName} @ {formatPkr(l.unitCostPaisa)}
                  {l.receivedQuantity !== null && l.receivedQuantity !== l.quantity && (
                    <span className="ml-1 text-warning-foreground">· {l.receivedQuantity} arrived</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs text-muted-foreground">
              Ordered by {po.createdByName ?? "?"}
              {po.approvedByName && ` · approved by ${po.approvedByName}`}
              {po.receivedByName && ` · received by ${po.receivedByName}`}
            </div>
            {(po.status === "DRAFT" || po.status === "APPROVED") && (
              <div className="mt-2 flex flex-wrap gap-2">
                {po.status === "DRAFT" && canApprove && <Button size="sm" onClick={() => step(po, "approve")}>Approve</Button>}
                {po.status === "APPROVED" && canReceive && (
                  <Button size="sm" variant="success" onClick={() => setReceiving(po)}>
                    Receive delivery
                  </Button>
                )}
                {canApprove && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => step(po, "cancel")}>
                    Cancel order
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>

      {drafting && suppliers && (
        <DraftDialog
          suppliers={suppliers.filter((s) => s.isActive)}
          locations={locations}
          items={items}
          onClose={() => setDrafting(false)}
          onCreated={async () => {
            setDrafting(false);
            await load();
          }}
        />
      )}
      {receiving && (
        <ReceiveDialog
          po={receiving}
          onClose={() => setReceiving(null)}
          onReceived={async () => {
            setReceiving(null);
            await load();
            onReceived();
          }}
        />
      )}
    </Card>
  );
}

function DraftDialog({
  suppliers,
  locations,
  items,
  onClose,
  onCreated,
}: {
  suppliers: Supplier[];
  locations: Location[];
  items: Item[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ itemId: string; quantity: string; cost: string }[]>([{ itemId: "", quantity: "", cost: "" }]);
  const [saving, setSaving] = useState(false);

  const ready =
    supplierId && locationId && lines.length > 0 && lines.every((l) => l.itemId && Number(l.quantity) > 0 && l.cost !== "" && Number(l.cost) >= 0);

  async function save() {
    setSaving(true);
    const { ok } = await send("/api/inventory/purchase-orders", {
      supplierId,
      locationId,
      notes: notes || null,
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCostPaisa: Math.round(Number(l.cost) * 100) })),
    });
    setSaving(false);
    if (ok) {
      toast.success("Purchase order drafted.");
      onCreated();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">New purchase order</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={(v) => setSupplierId(v ?? "")}>
                <SelectTrigger aria-label="Supplier">
                  <SelectValue>{(v: string) => suppliers.find((s) => s.id === v)?.name ?? "Pick a supplier"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Deliver to</Label>
              <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
                <SelectTrigger aria-label="Deliver to">
                  <SelectValue>{(v: string) => locations.find((l) => l.id === v)?.name ?? "Pick a location"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_110px_auto] items-center gap-2">
                <Select value={line.itemId} onValueChange={(v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, itemId: v ?? "" } : l)))}>
                  <SelectTrigger aria-label={`Item ${i + 1}`}>
                    <SelectValue>{(v: string) => items.find((it) => it.id === v)?.name ?? "Item"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>{it.name} ({it.unitOfMeasure})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min={0} step="any" placeholder="Qty" aria-label={`Quantity ${i + 1}`} value={line.quantity}
                  onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                <Input type="number" min={0} step="any" placeholder="Rs each" aria-label={`Cost each ${i + 1}`} value={line.cost}
                  onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, cost: e.target.value } : l)))} />
                <Button variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { itemId: "", quantity: "", cost: "" }])}>
              <Plus className="size-4" />
              Add a line
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-notes">Notes (optional)</Label>
            <Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || saving} onClick={save}>Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What actually arrived. Defaults to what was ordered, so a complete delivery is one tap. */
function ReceiveDialog({ po, onClose, onReceived }: { po: PurchaseOrder; onClose: () => void; onReceived: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(po.lines.map((l) => [l.id, String(l.quantity)])));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { ok } = await send(`/api/inventory/purchase-orders/${po.id}/receive`, {
      received: po.lines.map((l) => ({ lineId: l.id, quantity: Number(qty[l.id] || 0) })),
    });
    setSaving(false);
    if (ok) {
      toast.success(`PO #${po.number} received into stock.`);
      onReceived();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Receive PO #{po.number}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Change a number if less (or more) came than was ordered.</p>
        <div className="space-y-2">
          {po.lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {l.itemName} <span className="text-muted-foreground">(ordered {l.quantity} {l.unit})</span>
              </span>
              <Input type="number" min={0} step="any" className="w-28" aria-label={`Received ${l.itemName}`} value={qty[l.id]}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>Receive into stock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------------------------

export function SuppliersTab({ canManage }: { canManage: boolean }) {
  const { rows: suppliers, load } = useList<Supplier>("/api/inventory/suppliers", "suppliers");
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);

  async function save() {
    if (!editing) return;
    const { ok } = await send("/api/inventory/suppliers", {
      id: editing.id,
      name: editing.name ?? "",
      phone: editing.phone || null,
      email: editing.email || null,
      notes: editing.notes || null,
      isActive: editing.isActive ?? true,
    });
    if (ok) {
      toast.success("Supplier saved.");
      setEditing(null);
      await load();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="font-heading">Suppliers</CardTitle>
          <CardDescription>Who you buy stock from</CardDescription>
        </div>
        {canManage && (
          <Button onClick={() => setEditing({ isActive: true })}>
            <Plus className="size-4" />
            Add supplier
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {suppliers?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No suppliers yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="max-md:hidden">Email</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers?.map((s) => (
                <TableRow key={s.id} className={s.isActive ? "" : "text-muted-foreground"}>
                  <TableCell className="font-medium">
                    {s.name}
                    {!s.isActive && <span className="ml-1.5 text-xs">(not used)</span>}
                  </TableCell>
                  <TableCell>{s.phone ?? "—"}</TableCell>
                  <TableCell className="max-md:hidden">{s.email ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading">{editing.id ? "Edit supplier" : "Add supplier"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {(["name", "phone", "email", "notes"] as const).map((f) => (
                <div key={f} className="space-y-1.5">
                  <Label htmlFor={`supplier-${f}`}>{f[0].toUpperCase() + f.slice(1)}</Label>
                  <Input id={`supplier-${f}`} value={(editing[f] as string | null | undefined) ?? ""}
                    onChange={(e) => setEditing({ ...editing, [f]: e.target.value })} />
                </div>
              ))}
              {editing.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                  Still buying from them
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button disabled={!editing.name || editing.name.trim().length < 2} onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Transfers waiting for approval
// ---------------------------------------------------------------------------------------------

interface TransferRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  from: string;
  to: string;
  itemName: string;
  unit: string;
  quantity: number;
  note: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  rejectionReason: string | null;
}

export function TransferRequestsCard({ canApprove, reloadKey, onDecided }: { canApprove: boolean; reloadKey: number; onDecided: () => void }) {
  const { rows, load } = useList<TransferRequest>(`/api/inventory/transfer-requests?k=${reloadKey}`, "requests");
  const [declining, setDeclining] = useState<TransferRequest | null>(null);
  const pending = (rows ?? []).filter((r) => r.status === "PENDING");
  const recent = (rows ?? []).filter((r) => r.status !== "PENDING").slice(0, 5);

  async function decide(r: TransferRequest, body: { approve: true } | { approve: false; reason: string }) {
    const { ok } = await send(`/api/inventory/transfer-requests/${r.id}`, body);
    if (ok) {
      toast.success(body.approve ? "Approved — the stock has moved." : "Turned down.");
      setDeclining(null);
      await load();
      onDecided();
    }
  }

  if (!rows || rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Transfers waiting for approval</CardTitle>
        <CardDescription>Nothing moves until someone who can approve transfers says yes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {pending.length === 0 && <p className="text-muted-foreground">None waiting.</p>}
        {pending.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
            <span>
              {r.quantity} {r.unit} {r.itemName}: {r.from} → {r.to}
              <span className="block text-xs text-muted-foreground">
                asked by {r.requestedByName ?? "?"}
                {r.note ? ` · ${r.note}` : ""}
              </span>
            </span>
            {canApprove && (
              <span className="flex gap-2">
                <Button size="sm" onClick={() => decide(r, { approve: true })}>Approve</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeclining(r)}>Turn down</Button>
              </span>
            )}
          </div>
        ))}
        {recent.map((r) => (
          <div key={r.id} className="text-xs text-muted-foreground">
            {r.quantity} {r.unit} {r.itemName}: {r.from} → {r.to} · {r.status === "APPROVED" ? "approved" : `turned down (${r.rejectionReason})`} by{" "}
            {r.decidedByName ?? "?"}
          </div>
        ))}
      </CardContent>
      {declining && (
        <ReasonDialog
          title={`Turn down ${declining.quantity} ${declining.unit} ${declining.itemName}?`}
          confirmLabel="Turn down"
          onClose={() => setDeclining(null)}
          onConfirm={(reason) => decide(declining, { approve: false, reason })}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Recent adjustments, with undo
// ---------------------------------------------------------------------------------------------

interface Adjustment {
  id: string;
  itemName: string;
  unit: string;
  locationName: string;
  quantityDelta: number;
  reason: string | null;
  byName: string | null;
  createdAt: string;
  isUndo: boolean;
  undone: boolean;
}

export function RecentAdjustmentsCard({ canUndo, reloadKey, onUndone }: { canUndo: boolean; reloadKey: number; onUndone: () => void }) {
  const { rows, load } = useList<Adjustment>(`/api/inventory/adjustments?k=${reloadKey}`, "adjustments");
  const [undoing, setUndoing] = useState<Adjustment | null>(null);

  async function undo(a: Adjustment, reason: string) {
    const { ok } = await send(`/api/inventory/adjustment/${a.id}/reverse`, { reason });
    if (ok) {
      toast.success("Adjustment undone.");
      setUndoing(null);
      await load();
      onUndone();
    }
  }

  if (!rows || rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Recent adjustments</CardTitle>
        <CardDescription>An adjustment made by mistake is undone by an opposite one — nothing is deleted</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {rows.map((a) => (
          <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 ${a.undone ? "text-muted-foreground line-through" : ""}`}>
            <span>
              <span className="tabular-nums">{a.quantityDelta > 0 ? "+" : ""}{a.quantityDelta}</span> {a.unit} {a.itemName} · {a.locationName}
              <span className="block text-xs text-muted-foreground no-underline">
                {a.reason ?? ""} · {a.byName ?? "?"} · {new Date(a.createdAt).toLocaleString()}
              </span>
            </span>
            {canUndo && !a.undone && !a.isUndo && (
              <Button size="sm" variant="ghost" onClick={() => setUndoing(a)}>
                <Undo2 className="size-4" />
                Undo
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      {undoing && (
        <ReasonDialog
          title={`Undo ${undoing.quantityDelta > 0 ? "+" : ""}${undoing.quantityDelta} ${undoing.unit} ${undoing.itemName}?`}
          confirmLabel="Undo it"
          onClose={() => setUndoing(null)}
          onConfirm={(reason) => undo(undoing, reason)}
        />
      )}
    </Card>
  );
}
