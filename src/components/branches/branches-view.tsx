"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
            <Card key={b.id} className="shadow-sm">
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
    </div>
  );
}
