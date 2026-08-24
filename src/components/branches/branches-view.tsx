"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Percent } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  SERVICE: "Service",
};
const ALL_ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY", "SERVICE"];

interface Branch {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
}

export function BranchesView({ planName, maxBranches }: { planName: string; maxBranches: number | null }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => setBranches(d.branches ?? []))
      .catch(() => toast.error("Could not load branches."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const activeCount = branches.filter((b) => b.isActive).length;
  const atLimit = maxBranches !== null && activeCount >= maxBranches;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address: address || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not create branch.");
        return;
      }
      setName("");
      setAddress("");
      setOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-5" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">Branches</h1>
            <p className="text-sm text-muted-foreground">
              {planName} plan — {maxBranches === null ? "unlimited branches" : `up to ${maxBranches} branch${maxBranches === 1 ? "" : "es"}`}
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button disabled={atLimit} title={atLimit ? `Your ${planName} plan is at its branch limit` : undefined}>
                + Add branch
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">New branch</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="branch-name">Branch name</Label>
                <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-address">Address (optional)</Label>
                <Input id="branch-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create branch"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {atLimit && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          Your {planName} plan supports up to {maxBranches} branch{maxBranches === 1 ? "" : "es"}. Upgrade your plan from the
          super-admin panel to add more.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="space-y-2 pt-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardContent>
            </Card>
          ))}
        {!loading &&
          branches.map((b) => (
            <Card key={b.id} className="shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-heading text-base">{b.name}</CardTitle>
                <Badge variant={b.isActive ? "success" : "outline"}>{b.isActive ? "Active" : "Inactive"}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{b.address ?? "No address set"}</p>
              </CardContent>
            </Card>
          ))}
      </div>

      <OrderSettingsCard />
    </div>
  );
}

interface BranchSettingsDto {
  serviceChargeBasisPoints: number;
  serviceChargeAppliesTo: string[];
  serviceChargeTaxable: boolean;
  roundingMode: "NONE" | "NEAREST_1" | "NEAREST_5";
}

/** Order-level pricing settings — service charge %, which order types it applies to, whether it's
 * taxable, and cash rounding. These were previously stuck at their schema defaults (service charge
 * off, nearest-rupee rounding) forever: BranchSettings had the columns and the pricing engine
 * already read them, but no route accepted a write for anything except defaultStockLocationId, so
 * no tenant could ever turn a service charge on. Scoped to the signed-in admin's own branch, same
 * as Inventory's "Recipe consumption location" setting above — not a per-branch picker across the
 * whole tenant, since /api/branch-settings itself is scoped to session.branchId. */
function OrderSettingsCard() {
  const [settings, setSettings] = useState<BranchSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch("/api/branch-settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings ?? null))
      .catch(() => toast.error("Could not load order settings."));
  }, []);

  useEffect(load, [load]);

  async function save(patch: Partial<BranchSettingsDto>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const res = await fetch("/api/branch-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        toast.error("Could not save order settings.");
        load();
        return;
      }
      toast.success("Order settings saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  const servicePct = settings.serviceChargeBasisPoints / 100;

  return (
    <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Percent className="size-4" />
        </span>
        <div>
          <CardTitle className="font-heading text-base">Order settings — this branch</CardTitle>
          <p className="text-xs text-muted-foreground">Service charge and cash rounding. Off (0%) until you set a rate here.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="svc-pct">Service charge (%)</Label>
            <Input
              id="svc-pct"
              type="number"
              min={0}
              max={100}
              step={0.5}
              disabled={saving}
              defaultValue={servicePct}
              onBlur={(e) => {
                const pct = Number(e.target.value);
                if (Number.isNaN(pct) || pct < 0 || pct > 100) return;
                save({ serviceChargeBasisPoints: Math.round(pct * 100) });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Rounding</Label>
            <Select
              value={settings.roundingMode}
              onValueChange={(v) => v && save({ roundingMode: v as BranchSettingsDto["roundingMode"] })}
            >
              <SelectTrigger className="w-full" disabled={saving}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Exact (no rounding)</SelectItem>
                <SelectItem value="NEAREST_1">Nearest Rs 1</SelectItem>
                <SelectItem value="NEAREST_5">Nearest Rs 5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Applies to</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_ORDER_TYPES.map((t) => {
              const active = settings.serviceChargeAppliesTo.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const next = active
                      ? settings.serviceChargeAppliesTo.filter((x) => x !== t)
                      : [...settings.serviceChargeAppliesTo, t];
                    save({ serviceChargeAppliesTo: next });
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {ORDER_TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-3">
          <div>
            <div className="text-sm font-medium">Service charge is taxable</div>
            <p className="text-xs text-muted-foreground">Included in the taxable base before tax is calculated.</p>
          </div>
          <Switch
            checked={settings.serviceChargeTaxable}
            disabled={saving}
            onCheckedChange={(checked) => save({ serviceChargeTaxable: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
