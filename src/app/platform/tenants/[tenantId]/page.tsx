"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPkr } from "@/lib/money";

interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
    createdAt: string;
    subscription: { plan: { name: string; pricePaisaPerBranchMonth: number }; status: string; trialEndsAt: string | null } | null;
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
  const [impersonating, setImpersonating] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/platform/tenants/${params.tenantId}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => toast.error("Could not load tenant."));
  }, [params.tenantId]);

  useEffect(load, [load]);

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

  if (!detail) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const { tenant, users, recentActivity } = detail;

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <Link href="/platform/tenants" className="text-sm text-muted-foreground hover:underline">
        ← All tenants
      </Link>

      <header className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {tenant.slug} · {tenant.subscription?.plan.name ?? "No plan"} ·{" "}
            <Badge variant={tenant.status === "SUSPENDED" ? "destructive" : "secondary"}>{tenant.status}</Badge>
          </p>
        </div>
        <Button onClick={impersonate} disabled={impersonating}>
          {impersonating ? "Starting…" : "Impersonate owner"}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Branches ({tenant.branches.length})</CardTitle>
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
                    <TableCell>{b.name}</TableCell>
                    <TableCell>
                      <Badge variant={b.isActive ? "secondary" : "outline"}>{b.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>{new Date(b.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active staff ({users.length})</CardTitle>
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
                    <TableCell>{m.user.name}</TableCell>
                    <TableCell>{m.role.name}</TableCell>
                    <TableCell>{m.branch.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent platform activity</CardTitle>
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
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No platform-level activity yet.
                    </TableCell>
                  </TableRow>
                )}
                {recentActivity.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.action}</TableCell>
                    <TableCell>
                      {a.entityType}
                      {a.entityId ? ` #${a.entityId.slice(0, 8)}` : ""}
                    </TableCell>
                    <TableCell>{new Date(a.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {tenant.subscription && (
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>Plan: {tenant.subscription.plan.name}</div>
              <div>Price: {formatPkr(tenant.subscription.plan.pricePaisaPerBranchMonth)} / branch / month</div>
              <div>Status: {tenant.subscription.status}</div>
              {tenant.subscription.trialEndsAt && (
                <div>Trial ends: {new Date(tenant.subscription.trialEndsAt).toLocaleDateString()}</div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
