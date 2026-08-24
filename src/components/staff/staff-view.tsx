"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleId: string;
  roleName: string;
  branchId: string;
  branchName: string;
  isActive: boolean;
}

interface PendingInvite {
  id: string;
  email: string | null;
  roleName: string;
  branchName: string;
  expiresAt: string;
  token: string;
}

interface RoleOption {
  id: string;
  name: string;
  key: string;
}

interface BranchOption {
  id: string;
  name: string;
}

interface StaffData {
  members: Member[];
  invites: PendingInvite[];
  roles: RoleOption[];
  branches: BranchOption[];
}

export function StaffView({ canInvite, canManage }: { canInvite: boolean; canManage: boolean }) {
  const [data, setData] = useState<StaffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ link: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error("Could not load staff."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function toggleActive(member: Member) {
    const res = await fetch(`/api/staff/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !member.isActive }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not update.");
      return;
    }
    load();
  }

  async function revokeInvite(invite: PendingInvite) {
    const res = await fetch(`/api/staff/invites/${invite.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not revoke invite.");
      return;
    }
    toast.success("Invite revoked.");
    load();
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="size-5" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">Staff</h1>
            <p className="text-sm text-muted-foreground">Manage your team and pending invites.</p>
          </div>
        </div>
        {canInvite && <Button onClick={() => setInviteOpen(true)}>+ Invite staff</Button>}
      </div>

      {!loading && data && data.invites.length > 0 && (
        <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="font-heading text-base">Pending invites</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-2.5">
                <div>
                  <div className="text-sm font-medium">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {inv.roleName} · {inv.branchName} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLinkDialog({ link: `${window.location.origin}/invite/${inv.token}` })}
                  >
                    Copy link
                  </Button>
                  {canInvite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => revokeInvite(inv)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="font-heading text-base">
            {loading ? "Team" : `${data?.members.length ?? 0} team member${data?.members.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    {canManage && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                  </TableRow>
                ))}
              {!loading &&
                data?.members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.email ?? m.phone ?? "—"}</TableCell>
                    <TableCell>{m.roleName}</TableCell>
                    <TableCell className="text-muted-foreground">{m.branchName}</TableCell>
                    <TableCell>
                      <Badge variant={m.isActive ? "success" : "secondary"}>{m.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => toggleActive(m)}>
                          {m.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              {!loading && data?.members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="py-10 text-center text-muted-foreground">
                    No team members yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && (
        <InviteStaffDialog
          open={inviteOpen}
          roles={data.roles}
          branches={data.branches}
          onClose={() => setInviteOpen(false)}
          onCreated={(link) => {
            setInviteOpen(false);
            setLinkDialog({ link });
            load();
          }}
        />
      )}
      <InviteLinkDialog link={linkDialog?.link ?? null} onClose={() => setLinkDialog(null)} />
    </div>
  );
}

function InviteStaffDialog({
  open,
  roles,
  branches,
  onClose,
  onCreated,
}: {
  open: boolean;
  roles: RoleOption[];
  branches: BranchOption[];
  onClose: () => void;
  onCreated: (link: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roleId || !branchId) {
      toast.error("Choose a role and branch.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleId, branchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not create invite.");
        return;
      }
      setEmail("");
      setRoleId("");
      setBranchId("");
      onCreated(`${window.location.origin}/invite/${data.token}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Invite staff</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={roleId} onValueChange={(v) => v && setRoleId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a role">{(v: string) => roles.find((r) => r.id === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a branch">
                  {(v: string) => branches.find((b) => b.id === v)?.name ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            A link will be generated for you to send them — nothing is emailed automatically yet.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteLinkDialog({ link, onClose }: { link: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Invite link</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Send this link to your new team member — it lets them set their own password and expires in 7 days.
        </p>
        <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3">
          <div className="min-w-0 flex-1 truncate font-mono text-xs">{link}</div>
          <Button type="button" size="icon-sm" variant="ghost" onClick={copy} title="Copy link">
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
