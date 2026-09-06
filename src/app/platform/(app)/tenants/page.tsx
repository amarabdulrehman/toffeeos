"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Building2, Check, CircleDollarSign, Copy, PiggyBank, Store, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import { TIER_ORDER, TIER_LABEL, type TierKey } from "@/lib/tiers";
import { getBillingStatus } from "@/lib/billing";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

interface Metrics {
  tenantCount: number;
  byStatus: { TRIALING: number; ACTIVE: number; SUSPENDED: number; CANCELLED: number };
  totalBranches: number;
  mrrPaisa: number;
  overdueCount: number;
  customPricedCount: number;
  collectedThisMonthPaisa: number;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  createdAt: string;
  branchCount: number;
  userCount: number;
  plan: string | null;
  planKey: TierKey | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  customMonthlyPricePaisa: number | null;
}

const STATUS_VARIANT: Record<TenantRow["status"], "success" | "info" | "destructive" | "outline"> = {
  TRIALING: "info",
  ACTIVE: "success",
  SUSPENDED: "destructive",
  CANCELLED: "outline",
};

const TIER_VARIANT: Record<TierKey, "secondary" | "info" | "default"> = {
  starter: "secondary",
  growth: "info",
  complete: "default",
};

const PAGE_SIZE = 20;

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [provisioned, setProvisioned] = useState<{ name: string; slug: string; ownerEmail: string; tempPassword: string } | null>(
    null
  );

  const load = useCallback(async () => {
    const [tenantsRes, metricsRes] = await Promise.all([
      fetch(`/api/platform/tenants?page=${page}&pageSize=${PAGE_SIZE}`),
      fetch("/api/platform/metrics"),
    ]);
    if (!tenantsRes.ok) {
      toast.error("Could not load tenants.");
      setLoading(false);
      return;
    }
    const data = await tenantsRes.json();
    setTenants(data.tenants);
    setTotal(data.total);
    if (metricsRes.ok) setMetrics(await metricsRes.json());
    setLoading(false);
  }, [page]);

  useEffect(() => {
    // Wrapped in an inline async IIFE (rather than calling load() directly) so the effect body
    // itself never synchronously calls a setState-triggering function — see
    // https://react.dev/learn/you-might-not-need-an-effect for the canonical fetch-in-effect shape.
    (async () => {
      await load();
    })();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function toggleSuspend(tenant: TenantRow) {
    const nextStatus = tenant.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    const res = await fetch("/api/platform/tenants", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.id, status: nextStatus }),
    });
    if (!res.ok) {
      toast.error("Could not update tenant.");
      return;
    }
    toast.success(`${tenant.name} is now ${nextStatus.toLowerCase()}.`);
    load();
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Building2 className="size-5" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">Tenants</h1>
            <p className="text-sm text-muted-foreground">{total} restaurants, platform-wide</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Create tenant</Button>
      </div>

      {metrics && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Trialing" value={metrics.byStatus.TRIALING} icon={Store} />
          <StatCard label="Active" value={metrics.byStatus.ACTIVE} icon={Store} tone="success" />
          <StatCard
            label="Suspended"
            value={metrics.byStatus.SUSPENDED}
            icon={TriangleAlert}
            tone={metrics.byStatus.SUSPENDED > 0 ? "destructive" : undefined}
          />
          <StatCard
            label="Overdue"
            value={metrics.overdueCount}
            icon={TriangleAlert}
            tone={metrics.overdueCount > 0 ? "destructive" : undefined}
          />
          <StatCard label="Collected this month" value={formatPkr(metrics.collectedThisMonthPaisa)} icon={PiggyBank} />
          <StatCard label="MRR" value={formatPkr(metrics.mrrPaisa)} icon={CircleDollarSign} hero />
        </div>
      )}

      <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Restaurant</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid through</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && tenants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No tenants yet.
                  </TableCell>
                </TableRow>
              )}
              {tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                        {t.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {t.planKey ? <Badge variant={TIER_VARIANT[t.planKey]}>{TIER_LABEL[t.planKey]}</Badge> : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{t.branchCount}</TableCell>
                  <TableCell className="tabular-nums">{t.userCount}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const billing = getBillingStatus({
                        tenantStatus: t.status,
                        trialEndsAt: t.trialEndsAt,
                        currentPeriodEnd: t.currentPeriodEnd,
                      });
                      // Deliberately kept out of the Status column above — Status is what actually
                      // gates access, this is a non-blocking flag. Conflating them here would blur
                      // exactly the distinction an admin needs when deciding whether to suspend.
                      return <Badge variant={billing.badgeVariant}>{billing.label}</Badge>;
                    })()}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" render={<Link href={`/platform/tenants/${t.id}`} />} nativeButton={false}>
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={t.status === "SUSPENDED" ? "" : "text-destructive hover:bg-destructive/10"}
                      onClick={() => toggleSuspend(t)}
                    >
                      {t.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {pageCount} · {total} total
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <CreateTenantDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false);
          setProvisioned(result);
          setPage(1); // newest tenant sorts first — jump back to page 1 so it's visible
          load();
        }}
      />
      <TempPasswordDialog provisioned={provisioned} onClose={() => setProvisioned(null)} />
    </div>
  );
}

function CreateTenantDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { name: string; slug: string; ownerEmail: string; tempPassword: string }) => void;
}) {
  const [restaurantName, setRestaurantName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [branchName, setBranchName] = useState("Main Branch");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [city, setCity] = useState("");
  const [planKey, setPlanKey] = useState<TierKey>("starter");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setRestaurantName("");
    setSlug("");
    setSlugTouched(false);
    setBranchName("Main Branch");
    setOwnerName("");
    setOwnerEmail("");
    setCity("");
    setPlanKey("starter");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName, slug, branchName, ownerName, ownerEmail, city: city || undefined, planKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not create tenant.");
        return;
      }
      const created = { name: restaurantName, slug: data.slug, ownerEmail, tempPassword: data.tempPassword };
      reset();
      onCreated(created);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark">
        <DialogHeader>
          <DialogTitle className="font-heading">Create tenant</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="ct-name">Restaurant name</Label>
            <Input
              id="ct-name"
              value={restaurantName}
              onChange={(e) => {
                setRestaurantName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-slug">Restaurant URL</Label>
            <Input
              id="ct-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-branch">First branch name</Label>
            <Input id="ct-branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-city">City (optional)</Label>
            <Input id="ct-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-owner-name">Owner name</Label>
            <Input id="ct-owner-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-owner-email">Owner email</Label>
            <Input
              id="ct-owner-email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Starting plan</Label>
            <Select value={planKey} onValueChange={(v) => v && setPlanKey(v as TierKey)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a plan">{(v: string) => TIER_LABEL[v as TierKey] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIER_ORDER.map((key) => (
                  <SelectItem key={key} value={key}>
                    {TIER_LABEL[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Lands ACTIVE on this plan (not a trial) — this is for onboarding a client directly, not the free-trial funnel.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            A temporary password will be generated and shown once on the next screen — send it to the owner yourself.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TempPasswordDialog({
  provisioned,
  onClose,
}: {
  provisioned: { name: string; slug: string; ownerEmail: string; tempPassword: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!provisioned) return;
    await navigator.clipboard.writeText(provisioned.tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={!!provisioned} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark">
        <DialogHeader>
          <DialogTitle className="font-heading">{provisioned?.name} is live</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send these credentials to the owner. This password is shown only this once — it isn&apos;t stored
            anywhere and can&apos;t be retrieved again. They&apos;ll be required to set their own password on first
            login.
          </p>
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Restaurant URL</div>
              <div className="font-mono font-medium">{provisioned?.slug}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Owner email</div>
              <div className="font-medium">{provisioned?.ownerEmail}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Temporary password</div>
              <div className="flex items-center gap-2">
                <div className="font-mono font-semibold tracking-wide">{provisioned?.tempPassword}</div>
                <Button type="button" size="icon-sm" variant="ghost" onClick={copy} title="Copy password">
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

