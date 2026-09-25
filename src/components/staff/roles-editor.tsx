"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PERMISSIONS_BY_MODULE } from "@/server/permissions/registry";
import { cn } from "@/lib/utils";

interface Role {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  isStandard: boolean;
  isLocked: boolean;
  memberCount: number;
}

const MODULE_LABEL: Record<string, string> = {
  pos: "Till (POS)",
  orders: "Orders",
  tables: "Tables",
  kds: "Kitchen screen",
  menu: "Menu",
  recipe: "Recipes",
  costing: "Costing",
  inventory: "Inventory",
  delivery: "Delivery",
  crm: "Customers",
  online: "Online ordering",
  reports: "Reports",
  finance: "Expenses & P&L",
  hr: "HR & payroll",
  staff: "Staff",
  branch: "Branches",
  settings: "Settings",
  whatsapp: "WhatsApp",
  sync: "Offline sync",
  billing: "Plan & billing",
};

/**
 * What each role can do, as a checklist per area of the app. The Owner role is shown but locked:
 * it always has everything, including this screen.
 */
export function RolesEditor() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; permissions: Set<string> } | null>(null);
  const [signOutNow, setSignOutNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async (select?: string) => {
    const res = await fetch("/api/roles");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not load roles.");
      return;
    }
    const list = data.roles as Role[];
    setRoles(list);
    const pick = list.find((r) => r.id === select) ?? list.find((r) => !r.isLocked) ?? list[0];
    if (pick) {
      setSelectedId(pick.id);
      setDraft({ name: pick.name, permissions: new Set(pick.permissions) });
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const selected = roles?.find((r) => r.id === selectedId) ?? null;
  const dirty = useMemo(() => {
    if (!selected || !draft) return false;
    if (draft.name.trim() !== selected.name) return true;
    const before = new Set(selected.permissions);
    return draft.permissions.size !== before.size || [...draft.permissions].some((p) => !before.has(p));
  }, [selected, draft]);

  function choose(role: Role) {
    setSelectedId(role.id);
    setDraft({ name: role.name, permissions: new Set(role.permissions) });
    setSignOutNow(false);
  }

  function toggle(key: string, on: boolean) {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      if (on) next.add(key);
      else next.delete(key);
      return { ...d, permissions: next };
    });
  }

  async function save() {
    if (!selected || !draft) return;
    setSaving(true);
    const res = await fetch(`/api/roles/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, permissions: [...draft.permissions], signOutNow }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not save.");
      return;
    }
    toast.success(
      signOutNow && data.signedOut > 0
        ? `Saved. ${data.signedOut} ${data.signedOut === 1 ? "person was" : "people were"} signed out so it applies now.`
        : "Saved. It applies the next time each person signs in."
    );
    setSignOutNow(false);
    await load(selected.id);
  }

  async function create() {
    setSaving(true);
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, permissions: [] }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not add the role.");
      return;
    }
    toast.success(`Added "${data.role.name}". Tick what it can do, then save.`);
    setCreating(false);
    setNewName("");
    await load(data.role.id);
  }

  async function remove() {
    if (!selected) return;
    const res = await fetch(`/api/roles/${selected.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not remove the role.");
      return;
    }
    toast.success(`Removed "${selected.name}".`);
    await load();
  }

  if (!roles) return <p className="text-sm text-muted-foreground">Loading roles…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="font-heading text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => choose(r)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                r.id === selectedId ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"
              )}
            >
              <span className="flex items-center gap-1.5">
                {r.isLocked && <Lock className="size-3.5" />}
                {r.name}
              </span>
              <span className="text-xs text-muted-foreground">{r.memberCount}</span>
            </button>
          ))}
          {creating ? (
            <div className="space-y-2 pt-2">
              <Input
                autoFocus
                placeholder="e.g. Shift supervisor"
                aria-label="New role name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={saving || newName.trim().length < 2} onClick={create}>
                  Add
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="mt-2 w-full" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New role
            </Button>
          )}
        </CardContent>
      </Card>

      {selected && draft && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-heading">{selected.name}</CardTitle>
                <CardDescription>
                  {selected.isLocked
                    ? "The Owner role always has every permission, so it can't be changed."
                    : `${draft.permissions.size} permissions · ${selected.memberCount} ${selected.memberCount === 1 ? "person" : "people"}`}
                  {!selected.isLocked && selected.isStandard && <Badge variant="outline" className="ml-2">Standard</Badge>}
                </CardDescription>
              </div>
              {!selected.isLocked && (
                <Button variant="ghost" className="text-destructive" onClick={remove} disabled={selected.memberCount > 0}
                  title={selected.memberCount > 0 ? "Give these people another role first" : undefined}>
                  <Trash2 className="size-4" />
                  Remove role
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selected.isLocked && (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="role-name">Name</Label>
                <Input id="role-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {Object.entries(PERMISSIONS_BY_MODULE).map(([module, perms]) => (
                <fieldset key={module} className="rounded-xl border p-3">
                  <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {MODULE_LABEL[module] ?? module}
                  </legend>
                  <div className="space-y-1.5">
                    {perms.map((p) => (
                      <label key={p.key} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={draft.permissions.has(p.key)}
                          disabled={selected.isLocked}
                          onCheckedChange={(v) => toggle(p.key, v === true)}
                          aria-label={p.label}
                          className="mt-0.5"
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            {!selected.isLocked && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={signOutNow} onCheckedChange={(v) => setSignOutNow(v === true)} className="mt-0.5" />
                  <span>
                    Sign everyone in this role out, so the change applies now
                    <span className="block text-xs text-muted-foreground">
                      Otherwise it applies the next time each of them signs in.
                    </span>
                  </span>
                </label>
                <Button disabled={!dirty || saving} onClick={save}>
                  <ShieldCheck className="size-4" />
                  Save changes
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
