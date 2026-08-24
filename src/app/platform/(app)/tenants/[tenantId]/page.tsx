"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList, CreditCard, Lock, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";
import { TIER_ORDER, TIER_LABEL, GATEABLE_MODULES, defaultModulesForTier, type TierKey } from "@/lib/tiers";
import { getBillingStatus, effectiveMonthlyRatePaisa, PAYMENT_METHODS } from "@/lib/billing";
import { RecordPaymentDialog } from "@/components/platform/record-payment-dialog";

// Same 4-way mapping as the tenants list page (src/app/platform/(app)/tenants/page.tsx) — a
// tenant's status badge should read the same on both screens. This page previously collapsed it to
// a 2-way SUSPENDED/else check, which showed TRIALING and CANCELLED tenants as green "success"
// (a real bug, not just a style inconsistency — CANCELLED reading as success is actively misleading).
const STATUS_VARIANT: Record<TenantDetail["tenant"]["status"], "success" | "info" | "destructive" | "outline"> = {
  TRIALING: "info",
  ACTIVE: "success",
  SUSPENDED: "destructive",
  CANCELLED: "outline",
};

interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
    createdAt: string;
    subscription: {
      plan: { key: TierKey; name: string; maxBranches: number | null; pricePaisaPerBranchMonth: number };
      status: string;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      customMonthlyPricePaisa: number | null;
      enabledModules: string[];
    } | null;
    branches: { id: string; name: string; isActive: true | false; createdAt: string }[];
  };
  users: {
    userId: string;
    user: { id: string; name: string; email: string | null };
    role: { name: string; key: string };
    branch: { name: string };
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorId: string | null;
    createdAt: string;
    metadata: unknown;
  }[];
  payments: {
    id: string;
    amountPaisa: number;
    periodStart: string;
    periodEnd: string;
    method: string;
    note: string | null;
    recordedByEmail: string;
    voidedAt: string | null;
    voidReason: string | null;
    createdAt: string;
  }[];
}

function methodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

export default function TenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [changingTier, setChangingTier] = useState(false);
  const [pendingTier, setPendingTier] = useState<TierKey | null>(null);
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/platform/tenants/${params.tenantId}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error ?? "Could not load this tenant.");
        return;
      }
      setError(null);
      setDetail(body);
    } catch {
      setError("Could not load this tenant.");
    }
  }, [params.tenantId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function impersonate() {
    setImpersonating(true);
    try {
      const res = await fetch(`/api/platform/tenants/${params.tenantId}/impersonate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not start impersonation.");
        return;
      }
      router.push(`/impersonate?token=${encodeURIComponent(data.token)}`);
    } finally {
      setImpersonating(false);
    }
  }

  async function changePlan(planKey: TierKey) {
    setChangingTier(true);
    try {
      const res = await fetch(`/api/platform/tenants/${params.tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not change plan.");
        return;
      }
      toast.success(`Plan changed to ${TIER_LABEL[planKey]} — feature toggles reset to its defaults.`);
      await load();
    } finally {
      setChangingTier(false);
      setPendingTier(null);
    }
  }

  async function saveFeatures(enabledModules: string[]) {
    setSavingFeatures(true);
    try {
      const res = await fetch(`/api/platform/tenants/${params.tenantId}/features`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledModules }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save feature access.");
        return;
      }
      toast.success("Feature access updated.");
      await load();
    } finally {
      setSavingFeatures(false);
    }
  }

  if (error) {
    return (
      <div className="p-8">
        <Link href="/platform/tenants" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          All tenants
        </Link>
        <div className="mt-8 flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <Lock className="size-6 text-muted-foreground/50" />
          {error}
        </div>
      </div>
    );
  }
  if (!detail) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { tenant, users, recentActivity, payments } = detail;
  const sub = tenant.subscription;
  const billing = sub
    ? getBillingStatus({ tenantStatus: tenant.status, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd })
    : null;
  const activeBranchCount = tenant.branches.filter((b) => b.isActive).length;
  const monthlyRatePaisa = sub
    ? effectiveMonthlyRatePaisa({
        customMonthlyPricePaisa: sub.customMonthlyPricePaisa,
        activeBranchCount,
        pricePaisaPerBranchMonth: sub.plan.pricePaisaPerBranchMonth,
      })
    : 0;
  const lifetimeCollectedPaisa = payments.filter((p) => !p.voidedAt).reduce((a, p) => a + p.amountPaisa, 0);

  return (
    <div className="p-8">
      <Link href="/platform/tenants" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        All tenants
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{tenant.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {tenant.slug}
            {tenant.subscription && <Badge variant="secondary">{TIER_LABEL[tenant.subscription.plan.key]}</Badge>}
            <Badge variant={STATUS_VARIANT[tenant.status]}>{tenant.status}</Badge>
          </p>
        </div>
        <Button variant="warning" onClick={impersonate} disabled={impersonating}>
          <UserRound className="size-4" />
          {impersonating ? "Starting…" : "Impersonate owner"}
        </Button>
      </div>

      {billing && (billing.isOverdue || billing.state === "unbilled") && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="text-sm text-destructive">
            {billing.state === "unbilled" ? (
              <>No billing period has been recorded for {tenant.name} yet.</>
            ) : (
              <>
                Payment overdue — {billing.label.toLowerCase()}. Their access is <span className="font-semibold">not blocked</span> —
                record a payment below, or suspend them manually if you want to cut them off.
              </>
            )}
          </p>
          <Button size="sm" onClick={() => setRecordPaymentOpen(true)} className="shrink-0">
            Record payment
          </Button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="font-heading">Branches ({tenant.branches.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenant.branches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>
                      <Badge variant={b.isActive ? "success" : "outline"}>{b.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(b.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading">
              <UsersRound className="size-4" />
              Active staff ({users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="font-medium">{m.user.name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.role.name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.branch.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading">
              <ClipboardList className="size-4" />
              Recent platform activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No platform-level activity yet.
                    </TableCell>
                  </TableRow>
                )}
                {recentActivity.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.entityType}
                      {a.entityId ? ` #${a.entityId.slice(0, 8)}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {tenant.subscription && (
          <Card className="shadow-sm transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="font-heading">Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plan</span>
                <Select
                  value={tenant.subscription.plan.key}
                  onValueChange={(v) => v && v !== tenant.subscription!.plan.key && setPendingTier(v as TierKey)}
                >
                  <SelectTrigger className="h-8 w-36" disabled={changingTier}>
                    <SelectValue placeholder="Plan">{(v: string) => TIER_LABEL[v as TierKey] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TIER_ORDER.map((key) => (
                      <SelectItem key={key} value={key}>
                        {TIER_LABEL[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Branch limit</span>
                <span className="font-medium">{tenant.subscription.plan.maxBranches ?? "Unlimited"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price</span>
                <span className="font-medium tabular-nums">{formatPkr(tenant.subscription.plan.pricePaisaPerBranchMonth)} / branch / month</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">{tenant.subscription.status}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {sub && billing && (
          <Card className="shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 font-heading">
                <CreditCard className="size-4" />
                Billing
              </CardTitle>
              <Button size="sm" onClick={() => setRecordPaymentOpen(true)}>
                Record payment
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="mt-1">
                    <Badge variant={billing.badgeVariant}>{billing.label}</Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Monthly rate</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="font-medium tabular-nums">{formatPkr(monthlyRatePaisa, { showPaisa: true })}</span>
                    {sub.customMonthlyPricePaisa != null && <Badge variant="secondary">Custom</Badge>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Lifetime collected</div>
                  <div className="mt-1 font-medium tabular-nums">{formatPkr(lifetimeCollectedPaisa, { showPaisa: true })}</div>
                </div>
              </div>

              <Table className="mt-5">
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Recorded by</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No payments recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {payments.map((p) => (
                    <TableRow key={p.id} className={p.voidedAt ? "opacity-60" : undefined}>
                      <TableCell className={p.voidedAt ? "line-through" : undefined}>
                        {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                      </TableCell>
                      <TableCell className={`tabular-nums ${p.voidedAt ? "line-through" : "font-medium"}`}>
                        {formatPkr(p.amountPaisa, { showPaisa: true })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{methodLabel(p.method)}</Badge>
                        {p.voidedAt && (
                          <Badge variant="outline" className="ml-1.5">
                            Voided
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.recordedByEmail}</TableCell>
                      <TableCell className="text-muted-foreground">{p.voidedAt ? p.voidReason : (p.note ?? "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {tenant.subscription && (
          <Card className="shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-heading">
                <ShieldCheck className="size-4" />
                Feature access
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                The {TIER_LABEL[tenant.subscription.plan.key]} plan sets the default here — every feature stays
                independently toggleable afterward without snapping back, until the plan itself is changed again.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {GATEABLE_MODULES.map((mod) => {
                  const enabled = mod.storageKeys.every((k) => tenant.subscription!.enabledModules.includes(k));
                  return (
                    <div
                      key={mod.key}
                      className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium">{mod.label}</div>
                        <div className="text-xs text-muted-foreground">Default on {TIER_LABEL[mod.minTier]}+</div>
                      </div>
                      <Switch
                        checked={enabled}
                        disabled={savingFeatures}
                        onCheckedChange={(checked) => {
                          const current = tenant.subscription!.enabledModules;
                          const next = checked
                            ? [...new Set([...current, ...mod.storageKeys])]
                            : current.filter((k) => !mod.storageKeys.includes(k));
                          saveFeatures(next);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!pendingTier} onOpenChange={(o) => !o && setPendingTier(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">
              Change plan to {pendingTier ? TIER_LABEL[pendingTier] : ""}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This resets {tenant.name}&apos;s feature access to the {pendingTier ? TIER_LABEL[pendingTier] : ""} plan&apos;s
            defaults —{" "}
            {pendingTier && defaultModulesForTier(pendingTier).length > 0
              ? GATEABLE_MODULES.filter((m) => defaultModulesForTier(pendingTier).includes(m.key)).map((m) => m.label).join(", ")
              : "no gated features"}
            . Any per-feature customization you&apos;ve made will be overwritten. This can&apos;t be undone automatically —
            you&apos;d need to re-toggle anything custom afterward.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTier(null)}>
              Cancel
            </Button>
            <Button variant="warning" disabled={changingTier} onClick={() => pendingTier && changePlan(pendingTier)}>
              {changingTier ? "Changing…" : "Change plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sub && (
        <RecordPaymentDialog
          key={recordPaymentOpen ? "open" : "closed"}
          open={recordPaymentOpen}
          onClose={() => setRecordPaymentOpen(false)}
          onRecorded={load}
          tenantId={tenant.id}
          tenantName={tenant.name}
          tenantStatus={tenant.status}
          currentPeriodEnd={sub.currentPeriodEnd}
          effectiveMonthlyRatePaisa={monthlyRatePaisa}
        />
      )}
    </div>
  );
}
