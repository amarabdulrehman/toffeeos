"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPkr } from "@/lib/money";
import { BRAND_NAME } from "@/config/brand";

interface Metrics {
  tenantCount: number;
  byStatus: { TRIALING: number; ACTIVE: number; SUSPENDED: number; CANCELLED: number };
  totalBranches: number;
  mrrPaisa: number;
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
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
}

const STATUS_VARIANT: Record<TenantRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
  TRIALING: "secondary",
  ACTIVE: "default",
  SUSPENDED: "destructive",
  CANCELLED: "outline",
};

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [tenantsRes, metricsRes] = await Promise.all([
      fetch("/api/platform/tenants"),
      fetch("/api/platform/metrics"),
    ]);
    if (!tenantsRes.ok) {
      toast.error("Could not load tenants.");
      setLoading(false);
      return;
    }
    const data = await tenantsRes.json();
    setTenants(data.tenants);
    if (metricsRes.ok) setMetrics(await metricsRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // Wrapped in an inline async IIFE (rather than calling load() directly) so the effect body
    // itself never synchronously calls a setState-triggering function — see
    // https://react.dev/learn/you-might-not-need-an-effect for the canonical fetch-in-effect shape.
    (async () => {
      await load();
    })();
  }, [load]);

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
    <div className="min-h-screen bg-muted/30 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{BRAND_NAME} Platform</h1>
          <p className="text-sm text-muted-foreground">{tenants.length} tenants, platform-wide</p>
        </div>
        <Button variant="outline" onClick={() => signOut({ callbackUrl: "/platform/login" })}>
          Sign out
        </Button>
      </header>

      {metrics && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <MetricCard label="Trialing" value={metrics.byStatus.TRIALING} />
          <MetricCard label="Active" value={metrics.byStatus.ACTIVE} />
          <MetricCard label="Suspended" value={metrics.byStatus.SUSPENDED} />
          <MetricCard label="Total branches" value={metrics.totalBranches} />
          <MetricCard label="MRR" value={formatPkr(metrics.mrrPaisa)} />
        </div>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Restaurant</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Branches</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trial ends</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && tenants.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No tenants yet.
                </TableCell>
              </TableRow>
            )}
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.slug}</div>
                </TableCell>
                <TableCell>{t.plan ?? "—"}</TableCell>
                <TableCell>{t.branchCount}</TableCell>
                <TableCell>{t.userCount}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                </TableCell>
                <TableCell>{t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : "—"}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="outline" render={<Link href={`/platform/tenants/${t.id}`} />} nativeButton={false}>
                    View
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleSuspend(t)}>
                    {t.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
