"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, ChefHat, Image as ImageIcon, Percent, Plus, Receipt, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
const ROUNDING_LABELS: Record<string, string> = {
  NONE: "Exact (no rounding)",
  NEAREST_1: "Nearest Rs 1",
  NEAREST_5: "Nearest Rs 5",
};

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

  async function toggleBranch(branch: Branch) {
    const res = await fetch(`/api/branches/${branch.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !branch.isActive }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Could not update branch.");
      return;
    }
    toast.success(branch.isActive ? "Branch deactivated." : "Branch reactivated.");
    load();
  }

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
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{b.address ?? "No address set"}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className={b.isActive ? "text-destructive" : ""}
                  disabled={b.isActive && activeCount <= 1}
                  title={b.isActive && activeCount <= 1 ? "You can't deactivate your only active branch." : undefined}
                  onClick={() => toggleBranch(b)}
                >
                  {b.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </CardContent>
            </Card>
          ))}
      </div>

      <OrderSettingsCard />
      <ReceiptBrandingCard />
      <KitchenDisplayCard />
      <TaxRulesCard />
    </div>
  );
}

interface BranchSettingsDto {
  serviceChargeBasisPoints: number;
  serviceChargeAppliesTo: string[];
  serviceChargeTaxable: boolean;
  roundingMode: "NONE" | "NEAREST_1" | "NEAREST_5";
  maxDiscountBasisPoints: number;
  dayStartMinutes: number;
}

/** When a business day ends, as an owner would say it. Stored as the next day's start. */
const DAY_END_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Midnight (12am)" },
  { minutes: 60, label: "1am" },
  { minutes: 120, label: "2am" },
  { minutes: 180, label: "3am" },
  { minutes: 240, label: "4am" },
  { minutes: 300, label: "5am" },
  { minutes: 360, label: "6am" },
];

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
  // Uncontrolled input's live DOM value doubles as "the last rate the owner set" — read on demand
  // (switch turned back on after being off) rather than mirrored into React state, so there's no
  // effect needed to keep the two in sync. Disabling the input (service charge off) doesn't clear
  // it, so the number is still sitting there in the DOM if they turn it back on.
  const pctInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Percent className="size-4" />
        </span>
        <div>
          <CardTitle className="font-heading text-base">Order settings — this branch</CardTitle>
          <p className="text-xs text-muted-foreground">Service charge and cash rounding.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-3">
          <div>
            <div className="text-sm font-medium">Charge a service fee</div>
            <p className="text-xs text-muted-foreground">Off means no service charge on any order, regardless of the rate below.</p>
          </div>
          <Switch
            checked={settings.serviceChargeBasisPoints > 0}
            disabled={saving}
            onCheckedChange={(checked) => {
              if (!checked) {
                save({ serviceChargeBasisPoints: 0 });
                return;
              }
              const pct = Number(pctInputRef.current?.value);
              save({ serviceChargeBasisPoints: Math.round((pct > 0 ? pct : 5) * 100) });
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="svc-pct">Service charge (%)</Label>
            <Input
              id="svc-pct"
              ref={pctInputRef}
              type="number"
              min={0}
              max={100}
              step={0.5}
              disabled={saving || settings.serviceChargeBasisPoints === 0}
              defaultValue={settings.serviceChargeBasisPoints > 0 ? settings.serviceChargeBasisPoints / 100 : 5}
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
                {/* Select.Value shows the raw value ("NEAREST_1") without a render function — it
                 * never reads a SelectItem's children automatically. */}
                <SelectValue>{(v: string) => ROUNDING_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Exact (no rounding)</SelectItem>
                <SelectItem value="NEAREST_1">Nearest Rs 1</SelectItem>
                <SelectItem value="NEAREST_5">Nearest Rs 5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Asked as "when does your day end?" because that is how an owner thinks about it; stored as
            when the next one starts. A café open until 2am wants 1:30am counted as tonight. */}
        <div className="space-y-1.5 border-t pt-4">
          <Label>Business day ends at</Label>
          <Select
            value={String(settings.dayStartMinutes)}
            onValueChange={(v) => v != null && save({ dayStartMinutes: Number(v) })}
          >
            <SelectTrigger className="w-full sm:w-64" disabled={saving}>
              <SelectValue>
                {(v: string) => DAY_END_OPTIONS.find((o) => String(o.minutes) === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DAY_END_OPTIONS.map((o) => (
                <SelectItem key={o.minutes} value={String(o.minutes)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Sales made after midnight but before this time count toward the previous day — in Daily Sales,
            the reports and the cash drawer. Leave it at midnight if you close before then.
          </p>
        </div>

        {/* The discount ceiling lives with the other money settings rather than on the roles screen,
            because it is a property of the branch, not of a person: the roles screen says who may
            go past it, this says what "past it" means. Both are needed — the permission sat there
            gating nothing until this number existed. */}
        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="max-discount">Largest discount staff may apply (%)</Label>
          <Input
            id="max-discount"
            type="number"
            min={0}
            max={100}
            step={1}
            disabled={saving}
            defaultValue={settings.maxDiscountBasisPoints / 100}
            onBlur={(e) => {
              const pct = Number(e.target.value);
              if (Number.isNaN(pct) || pct < 0 || pct > 100) return;
              save({ maxDiscountBasisPoints: Math.round(pct * 100) });
            }}
          />
          <p className="text-xs text-muted-foreground">
            {settings.maxDiscountBasisPoints >= 10000
              ? "Currently 100% — no limit. Anyone who can apply a discount can take the whole bill off. Lower this to cap it."
              : `Discounts over ${settings.maxDiscountBasisPoints / 100}% are refused. Staff whose role grants ` +
                `"Exceed maximum discount" are not bound by it.`}
          </p>
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

/** Some cafes run the kitchen right at the counter and have no use for a dedicated Kitchen
 * Display screen — this doesn't touch the order lifecycle at all (send-to-kitchen, KOT printing,
 * everything a cashier does at the counter keeps working exactly the same); it only hides the KDS
 * nav link/dashboard tile and blocks the /kds route itself for this branch. See
 * getBranchKdsEnabled in src/server/branch-settings.ts. */
function KitchenDisplayCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/branch-settings")
      .then((r) => r.json())
      .then((d) => setEnabled(d.settings?.kdsEnabled ?? true))
      .catch(() => toast.error("Could not load Kitchen Display settings."));
  }, []);

  async function toggle(checked: boolean) {
    setEnabled(checked);
    setSaving(true);
    try {
      const res = await fetch("/api/branch-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kdsEnabled: checked }),
      });
      if (!res.ok) {
        toast.error("Could not save Kitchen Display setting.");
        setEnabled(!checked);
        return;
      }
      toast.success(checked ? "Kitchen Display System turned on." : "Kitchen Display System turned off.");
    } finally {
      setSaving(false);
    }
  }

  if (enabled === null) return null;

  return (
    <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ChefHat className="size-4" />
        </span>
        <div>
          <CardTitle className="font-heading text-base">Kitchen Display System — this branch</CardTitle>
          <p className="text-xs text-muted-foreground">Turn off if the kitchen works off a printed ticket at the counter instead.</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-3">
          <div>
            <div className="text-sm font-medium">Use the Kitchen Display System</div>
            <p className="text-xs text-muted-foreground">
              Off hides KDS from the sidebar and dashboard, and blocks the /kds screen for this branch. Sending orders to the
              kitchen and printing KOTs keep working the same either way.
            </p>
          </div>
          <Switch checked={enabled} disabled={saving} onCheckedChange={toggle} />
        </div>
      </CardContent>
    </Card>
  );
}

interface TaxRuleDto {
  id: string;
  name: string;
  paymentMethods: string[];
  rateBasisPoints: number;
  isActive: boolean;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};
const ALL_PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"];

function formatRatePct(basisPoints: number): string {
  const pct = basisPoints / 100;
  return basisPoints % 100 === 0 ? pct.toFixed(0) : pct.toFixed(1);
}

/** Tax was previously all-or-nothing and fixed at whatever the tenant was seeded with at signup
 * (see tenant-signup.ts's Punjab PRA default) — the schema and pricing engine (resolveTaxRate in
 * src/lib/pricing.ts) already fully supported per-branch, per-payment-method, any-rate tax rules
 * and "zero active rules = 0% tax," but nothing ever exposed that to an owner to actually change.
 * This is that missing settings surface — same permission (settings.tax.manage) the registry
 * already reserved for it. */
function TaxRulesCard() {
  const [rules, setRules] = useState<TaxRuleDto[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxRuleDto | null>(null);

  const load = useCallback(() => {
    fetch("/api/tax-rules")
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch(() => toast.error("Could not load tax rules."));
  }, []);

  useEffect(load, [load]);

  async function toggleActive(rule: TaxRuleDto) {
    const res = await fetch(`/api/tax-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (!res.ok) {
      toast.error("Could not update tax rule.");
      return;
    }
    toast.success(rule.isActive ? "Tax rule turned off." : "Tax rule turned on.");
    load();
  }

  async function deleteRule(rule: TaxRuleDto) {
    if (!window.confirm(`Delete the tax rule "${rule.name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/tax-rules/${rule.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete tax rule.");
      return;
    }
    toast.success("Tax rule deleted.");
    load();
  }

  if (!rules) return null;

  const anyActive = rules.some((r) => r.isActive);

  return (
    <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Receipt className="size-4" />
          </span>
          <div>
            <CardTitle className="font-heading text-base">Tax — this branch</CardTitle>
            <p className="text-xs text-muted-foreground">
              {anyActive ? "Applied automatically at checkout, per the rules below." : "No tax is currently applied to any order."}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          Add rule
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.length === 0 && (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            No tax rules set up — orders won&apos;t be taxed until you add one.
          </p>
        )}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`flex items-center justify-between rounded-xl border px-3.5 py-3 transition-colors ${
              rule.isActive ? "bg-background" : "bg-muted/20 opacity-70"
            }`}
          >
            <button
              type="button"
              className="text-left"
              onClick={() => {
                setEditing(rule);
                setDialogOpen(true);
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium hover:underline">
                {rule.name}
                <Badge variant="secondary">{formatRatePct(rule.rateBasisPoints)}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {rule.paymentMethods.length === 0
                  ? "All payment methods"
                  : rule.paymentMethods.map((m) => PAYMENT_METHOD_LABEL[m] ?? m).join(", ")}
              </p>
            </button>
            <div className="flex items-center gap-2">
              <Switch checked={rule.isActive} onCheckedChange={() => toggleActive(rule)} />
              <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => deleteRule(rule)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <TaxRuleDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        editing={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSaved={load}
      />
    </Card>
  );
}

function TaxRuleDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: TaxRuleDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Initialized straight from `editing` rather than synced via an effect — the caller keys this
  // component by editing?.id (see TaxRulesCard), so a fresh mount (and fresh initializer run)
  // happens every time a different rule is opened, or "Add rule" is chosen after an edit.
  const [name, setName] = useState(editing?.name ?? "");
  const [rate, setRate] = useState(editing ? String(editing.rateBasisPoints / 100) : "16");
  const [methods, setMethods] = useState<string[]>(editing?.paymentMethods ?? []);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(rate);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error("Enter a rate between 0 and 100.");
      return;
    }
    setSubmitting(true);
    try {
      const body = { name, rateBasisPoints: Math.round(pct * 100), paymentMethods: methods };
      const res = await fetch(editing ? `/api/tax-rules/${editing.id}` : "/api/tax-rules", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not save tax rule.");
        return;
      }
      toast.success(editing ? "Tax rule updated." : "Tax rule added.");
      onClose();
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">{editing ? "Edit tax rule" : "Add tax rule"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tax-name">Name</Label>
            <Input id="tax-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales tax" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-rate">Rate (%)</Label>
            <Input
              id="tax-rate"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMethods([])}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  methods.length === 0
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60"
                }`}
              >
                All payment methods
              </button>
              {ALL_PAYMENT_METHODS.map((m) => {
                const active = methods.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethods(active ? methods.filter((x) => x !== m) : [...methods, m])}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    {PAYMENT_METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Leave on &quot;All payment methods&quot; for one flat rate. Pick specific methods only if you need a
              different rate for cash vs. card (e.g. Punjab PRA&apos;s split rate).
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save changes" : "Add rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Logo on printed receipts. Two settings that live in different places deliberately, presented as
 * one thing because to a restaurant owner it is one thing:
 *
 *   - the logo itself is tenant-wide (Tenant.logoUrl) — the same image the online storefront uses,
 *     so a client uploads it once rather than once per branch;
 *   - whether it prints is per-branch (BranchSettings.showLogoOnReceipt), matching receiptHeader.
 *
 * Upload rather than a URL field: a restaurant owner has a logo file on their phone or laptop, not
 * a hosted image URL.
 */
function ReceiptBrandingCard() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState<boolean | null>(null);
  const [header, setHeader] = useState("");
  const [savedHeader, setSavedHeader] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const [brandingRes, settingsRes] = await Promise.all([
        fetch("/api/tenant-branding"),
        fetch("/api/branch-settings"),
      ]);
      if (brandingRes.ok) setLogoUrl((await brandingRes.json())?.logoUrl ?? null);
      if (settingsRes.ok) {
        const st = (await settingsRes.json()).settings;
        setShowLogo(st?.showLogoOnReceipt ?? false);
        setHeader(st?.receiptHeader ?? "");
        setSavedHeader(st?.receiptHeader ?? "");
      } else setShowLogo(false);
    })().catch(() => toast.error("Could not load receipt branding."));
  }, []);

  async function onPickFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/tenant-branding/logo", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The route returns the real reason for the two a user can fix (wrong type, too large).
        toast.error(body.error ?? "Could not upload that logo.");
        return;
      }
      setLogoUrl(body.logoUrl);
      toast.success("Logo uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function toggle(checked: boolean) {
    setShowLogo(checked);
    setSaving(true);
    try {
      const res = await fetch("/api/branch-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showLogoOnReceipt: checked }),
      });
      if (!res.ok) {
        toast.error("Could not save that setting.");
        setShowLogo(!checked); // put the switch back rather than lie about what was saved
        return;
      }
      toast.success(checked ? "Logo will print on receipts." : "Logo removed from receipts.");
    } finally {
      setSaving(false);
    }
  }

  async function saveHeader() {
    setSavingHeader(true);
    try {
      const res = await fetch("/api/branch-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptHeader: header }),
      });
      if (!res.ok) {
        toast.error("Could not save the receipt header.");
        return;
      }
      // Read back what the server stored: it trims and turns an empty string into null, so the
      // dirty check below compares against reality rather than what was typed.
      const saved = (await res.json()).settings?.receiptHeader ?? "";
      setHeader(saved);
      setSavedHeader(saved);
      toast.success("Receipt header saved.");
    } finally {
      setSavingHeader(false);
    }
  }

  if (showLogo === null) return null;

  return (
    <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Receipt className="size-4" />
        </span>
        <div>
          <CardTitle className="font-heading text-base">Receipt — this branch</CardTitle>
          <p className="text-xs text-muted-foreground">
            What prints at the top of every receipt from this branch. The logo is shared across your
            branches; everything else here applies to this one.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 rounded-xl border bg-muted/20 px-3.5 py-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <ImageIcon className="size-6 text-muted-foreground/50" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{logoUrl ? "Your logo" : "No logo yet"}</div>
            <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2MB.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickFile(file);
            }}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : logoUrl ? "Replace" : "Upload logo"}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-3">
          <div>
            <div className="text-sm font-medium">Print the logo on receipts</div>
            <p className="text-xs text-muted-foreground">
              {logoUrl
                ? "Prints above your restaurant name. Most receipt printers are black and white, so it prints in greyscale."
                : "Upload a logo first — there is nothing to print yet."}
            </p>
          </div>
          <Switch checked={showLogo} disabled={saving || !logoUrl} onCheckedChange={toggle} />
        </div>

        <div className="space-y-2 rounded-xl border bg-muted/20 px-3.5 py-3">
          <div>
            <Label htmlFor="receipt-header" className="text-sm font-medium">
              Header text
            </Label>
            <p className="text-xs text-muted-foreground">
              Printed under the branch name — address, phone, NTN number. Line breaks print as you
              type them.
            </p>
          </div>
          <Textarea
            id="receipt-header"
            rows={3}
            maxLength={280}
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            placeholder={"Shop 4, Main Boulevard, Gulberg\n0300-1234567\nNTN 1234567-8"}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{header.length}/280</span>
            {/* Only offered when there is something to save — a Save button that does nothing is
                worse than no button. */}
            <Button size="sm" variant="outline" disabled={savingHeader || header === savedHeader} onClick={saveHeader}>
              {savingHeader ? "Saving…" : "Save header"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
