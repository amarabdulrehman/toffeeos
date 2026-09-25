"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface MenuItem {
  id: string;
  name: string;
  isAvailableOnline?: boolean;
}
interface Category {
  id: string;
  name: string;
  items: MenuItem[];
}

/**
 * Which dishes customers can order online or from a table's QR code. Off for something that doesn't
 * travel, or that the counter only makes to order; the till always sells everything.
 */
export function OnlineMenuCard() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/menu")
      .then((r) => r.json())
      .then((d) => !cancelled && setCategories(d.categories ?? []))
      .catch(() => !cancelled && setCategories([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(item: MenuItem, on: boolean) {
    setBusy(item.id);
    const res = await fetch(`/api/menu-items/${item.id}/online`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAvailableOnline: on }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Could not change that.");
      return;
    }
    setCategories((cats) =>
      (cats ?? []).map((c) => ({ ...c, items: c.items.map((i) => (i.id === item.id ? { ...i, isAvailableOnline: on } : i)) }))
    );
    toast.success(on ? `${item.name} is on the online menu.` : `${item.name} is off the online menu.`);
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Online menu</CardTitle>
        <CardDescription>What customers can order online and from table QR codes. The till always has everything.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {categories?.map((c) => (
          <div key={c.id}>
            <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{c.name}</div>
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {c.items.map((i) => (
                <label key={i.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{i.name}</span>
                  <Switch
                    checked={i.isAvailableOnline !== false}
                    disabled={busy === i.id}
                    onCheckedChange={(v) => toggle(i, v)}
                    aria-label={`Show ${i.name} online`}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
