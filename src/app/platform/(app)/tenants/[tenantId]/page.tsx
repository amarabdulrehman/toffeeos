"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList, Lock, UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPkr } from "@/lib/money";
import { TIER_ORDER, TIER_LABEL, type TierKey } from "@/lib/tiers";

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
}

export default function TenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [changingTier, setChangingTier] = useState(false);

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
      toast.success(`Plan changed to ${TIER_LABEL[planKey]}.`);
      await load();
    } finally {
      setChangingTier(false);
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
  const { tenant, users, recentActivity } = detail;

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
            <Badge variant={tenant.status === "SUSPENDED" ? "destructive" : "success"}>{tenant.status}</Badge>
          </p>
        </div>
        <Button variant="warning" onClick={impersonate} disabled={impersonating}>
          <UserRound className="size-4" />
          {impersonating ? "Starting…" : "Impersonate owner"}
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
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

        <Card className="shadow-sm">
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

        <Card className="shadow-sm lg:col-span-2">
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
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-heading">Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plan</span>
                <Select
                  value={tenant.subscription.plan.key}
                  onValueChange={(v) => v && v !== tenant.subscription!.plan.key && changePlan(v as TierKey)}
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
              {tenant.subscription.trialEndsAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trial ends</span>
                  <span className="font-medium">{new Date(tenant.subscription.trialEndsAt).toLocaleDateString()}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
