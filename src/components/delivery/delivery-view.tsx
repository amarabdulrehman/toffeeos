"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { Truck, PackageCheck, Bike } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";

interface BoardOrder {
  id: string;
  orderNumber: number;
  totalPaisa: number;
  createdAt: string;
  assignedRiderId: string | null;
  deliveryProofMethod: string | null;
  deliveryAddress: string | null;
}
interface Board {
  readyForPickup: BoardOrder[];
  inProgress: BoardOrder[];
  delivered: BoardOrder[];
  /** Delivered cash-on-delivery orders whose cash hasn't been handed in yet. */
  awaitingCash?: BoardOrder[];
}
interface Rider {
  userId: string;
  membershipId: string;
  name: string;
  phone: string | null;
  employeeId: string | null;
  isActive: boolean;
  activeDeliveryCount: number;
}

export function DeliveryView({ canSettleCash = false }: { canSettleCash?: boolean }) {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Truck className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Delivery</h1>
          <p className="text-sm text-muted-foreground">Dispatch board and rider roster for this branch.</p>
        </div>
      </div>

      <Tabs defaultValue="board" className="mt-6">
        <TabsList>
          <TabsTrigger value="board" className="gap-1.5">
            <PackageCheck className="size-3.5" />
            Delivery Orders
          </TabsTrigger>
          <TabsTrigger value="riders" className="gap-1.5">
            <Bike className="size-3.5" />
            Riders
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="mt-4">
          <DeliveryBoard canSettleCash={canSettleCash} />
        </TabsContent>
        <TabsContent value="riders" className="mt-4">
          <RidersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DeliveryBoard({ canSettleCash }: { canSettleCash: boolean }) {
  const [board, setBoard] = useState<Board>({ readyForPickup: [], inProgress: [], delivered: [], awaitingCash: [] });
  // null = riders haven't loaded yet, distinct from "loaded, zero riders". Unfiltered otherwise —
  // an order assigned before a rider was deactivated still needs their name to resolve in the
  // Select below (see activeRiders/assignedInactiveRider split in the render).
  const [riders, setRiders] = useState<Rider[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/delivery/board")
      .then((r) => r.json())
      .then(setBoard)
      .catch(() => {});
    fetch("/api/riders")
      .then((r) => r.json())
      .then((d) => setRiders(d.riders ?? []))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  /** The rider is back with the cash: record it as paid, in cash, in full. */
  async function settle(order: BoardOrder) {
    const res = await fetch(`/api/orders/${order.id}/settle-delivery`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not record the cash.");
      return;
    }
    toast.success(`Order #${order.orderNumber}: cash received.`);
    load();
  }

  async function assign(orderId: string, riderId: string) {
    const res = await fetch(`/api/orders/${orderId}/assign-rider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ riderId }),
    });
    if (!res.ok) {
      toast.error("Could not assign rider.");
      return;
    }
    toast.success("Rider assigned.");
    load();
  }

  const awaiting = board.awaitingCash ?? [];

  return (
    <div className="space-y-6">
    {awaiting.length > 0 && (
      <Card className="border-warning/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Delivered — cash still with the rider
            <Badge variant="warning">{awaiting.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {awaiting.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 p-3">
              <span>
                <span className="font-heading font-semibold">#{o.orderNumber}</span>
                <span className="ml-2 text-sm tabular-nums">{formatPkr(o.totalPaisa)}</span>
                {o.deliveryAddress && <span className="block text-xs text-muted-foreground">{o.deliveryAddress}</span>}
              </span>
              {canSettleCash && (
                <Button size="sm" variant="success" onClick={() => settle(o)}>
                  Cash received
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    )}
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <BoardColumn title="Ready for Pickup" orders={board.readyForPickup}>
        {(order) => {
          if (riders === null) {
            return <div className="mt-2 h-8 w-full animate-pulse rounded-lg bg-muted" />;
          }
          const activeRiders = riders.filter((r) => r.isActive);
          // A rider assigned before being deactivated won't be in activeRiders — surfaced as a
          // disabled option (with the current-value lookup below) instead of just vanishing, so
          // dispatch can still see who it's currently sitting with.
          const assignedInactiveRider =
            order.assignedRiderId && !activeRiders.some((r) => r.userId === order.assignedRiderId)
              ? riders.find((r) => r.userId === order.assignedRiderId)
              : undefined;
          return (
            <Select value={order.assignedRiderId ?? undefined} onValueChange={(v) => v && assign(order.id, v)}>
              <SelectTrigger className="mt-2 h-8 text-xs">
                {/* Select.Value never auto-resolves a SelectItem's children as its label — Base UI
                 * only does that when given the root `items` prop; otherwise it renders the raw
                 * `value` verbatim (a rider id/UUID here). A custom render function is this
                 * codebase's established fix for that — see e.g. menu-view.tsx's category picker. */}
                <SelectValue placeholder="Assign rider">
                  {(v: string | undefined) => (v ? (riders.find((r) => r.userId === v)?.name ?? v) : "Assign rider")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignedInactiveRider && (
                  <SelectItem value={assignedInactiveRider.userId} disabled>
                    {assignedInactiveRider.name} (inactive)
                  </SelectItem>
                )}
                {activeRiders.map((r) => (
                  <SelectItem key={r.userId} value={r.userId}>
                    {r.name} ({r.activeDeliveryCount} active)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }}
      </BoardColumn>
      <BoardColumn title="In Progress" orders={board.inProgress} />
      <BoardColumn title="Delivered" orders={board.delivered}>
        {(order) => (
          <Badge variant="secondary" className="mt-2">
            {order.deliveryProofMethod === "PHOTO" ? "Photo confirmed" : "Code confirmed"}
          </Badge>
        )}
      </BoardColumn>
    </div>
    </div>
  );
}

function BoardColumn({
  title,
  orders,
  children,
}: {
  title: string;
  orders: BoardOrder[];
  children?: (order: BoardOrder) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          {title}
          <Badge variant="outline">{orders.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders.</p>}
        {orders.map((o) => (
          <div key={o.id} className="rounded-xl border border-border/60 bg-muted/20 p-3 shadow-xs transition-colors hover:border-border">
            <div className="flex items-center justify-between">
              <span className="font-heading font-semibold">#{o.orderNumber}</span>
              <span className="text-sm font-medium tabular-nums">{formatPkr(o.totalPaisa)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(o.createdAt), { addSuffix: true })}
            </div>
            {o.deliveryAddress && <div className="mt-1 text-xs text-muted-foreground">📍 {o.deliveryAddress}</div>}
            {children?.(o)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** What a rider needs to sign in, shown once: only the password's hash is kept. */
interface IssuedSignIn {
  name: string;
  phone: string;
  password: string;
}

function RidersTab() {
  const { data: session } = useSession();
  const tenantSlug = session?.user && "tenantSlug" in session.user ? session.user.tenantSlug : "";
  const [riders, setRiders] = useState<Rider[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [issued, setIssued] = useState<IssuedSignIn | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/riders")
      .then((r) => r.json())
      .then((d) => setRiders(d.riders ?? []))
      .catch(() => toast.error("Could not load riders — check your connection."));
  }, []);

  useEffect(load, [load]);

  async function create() {
    if (!name.trim() || !phone.trim()) {
      toast.error("Name and phone are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/riders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, employeeId: employeeId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not add rider.");
        return;
      }
      setIssued({ name: data.rider.name, phone: data.rider.phone, password: data.password });
      toast.success("Rider added.");
      setName("");
      setPhone("");
      setEmployeeId("");
      load();
    } catch {
      toast.error("Could not add rider — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(rider: Rider) {
    if (!window.confirm(`Give ${rider.name} a new password? Their old one stops working and they are signed out.`)) return;
    try {
      const res = await fetch(`/api/riders/${rider.userId}/reset-password`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not reset the password.");
        return;
      }
      setIssued({ name: rider.name, phone: rider.phone ?? "", password: data.password });
    } catch {
      toast.error("Could not reset the password — check your connection.");
    }
  }

  async function toggleActive(rider: Rider) {
    try {
      const res = await fetch(`/api/riders/${rider.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rider.isActive }),
      });
      if (!res.ok) {
        toast.error("Could not update rider.");
        return;
      }
      load();
    } catch {
      toast.error("Could not update rider — check your connection.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="rider-name">Name</Label>
            <Input id="rider-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rider-phone">Phone</Label>
            <Input id="rider-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xxxxxxxxx" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rider-employee-id">Employee ID (optional)</Label>
            <Input id="rider-employee-id" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          </div>
          <Button onClick={create} disabled={busy} className="self-end">
            Add rider
          </Button>
        </div>

        {issued && (
          <div role="status" className="space-y-2 rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-sm">
            <div className="font-semibold">Give these to {issued.name} to sign in</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Sign in at</dt>
              <dd className="font-medium">{typeof window !== "undefined" ? window.location.host : ""}/rider/login</dd>
              <dt className="text-muted-foreground">Restaurant URL</dt>
              <dd className="font-mono font-medium">{tenantSlug}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="font-mono font-medium">{issued.phone}</dd>
              <dt className="text-muted-foreground">Password</dt>
              <dd className="font-mono text-base font-bold tracking-wider" data-testid="rider-password">
                {issued.password}
              </dd>
            </dl>
            <p className="text-muted-foreground">
              This password won&apos;t be shown again. If it&apos;s lost, use Reset password to make a new one.
            </p>
            <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {riders.map((r) => (
            <div key={r.userId} className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3 shadow-xs">
              <div>
                <div className="font-medium">
                  {r.name} {r.employeeId ? `· ${r.employeeId}` : ""}
                </div>
                <div className="text-sm text-muted-foreground">
                  {r.phone} · {r.activeDeliveryCount} active deliveries
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={r.isActive ? "success" : "outline"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                {r.isActive && (
                  <Button size="sm" variant="outline" onClick={() => resetPassword(r)}>
                    Reset password
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => toggleActive(r)}>
                  {r.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
