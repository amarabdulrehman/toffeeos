"use client";

import { useState } from "react";
import { UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CustomerDto } from "./types";

export function CustomerPicker({
  customer,
  onSelect,
  onClear,
}: {
  customer: CustomerDto | null;
  onSelect: (customer: CustomerDto) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<CustomerDto[]>([]);
  const [name, setName] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function search(q: string) {
    setPhone(q);
    if (q.trim().length < 3) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setMatches(data.customers ?? []);
    } catch {
      // Offline: no matches to show; the order can go ahead without a customer.
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }

  async function attach(existing?: CustomerDto) {
    if (existing) {
      onSelect(existing);
      close();
      return;
    }
    if (!phone.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/customers/find-or-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save customer.");
        return;
      }
      onSelect(data.customer);
      close();
    } catch {
      toast.error("Can't reach the server, so the customer wasn't saved. The order can go ahead without one.");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setOpen(false);
    setPhone("");
    setName("");
    setMatches([]);
  }

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-muted-foreground" />
          <span className="font-medium">{customer.name ?? customer.phone}</span>
          {customer.name && <span className="text-muted-foreground">{customer.phone}</span>}
        </div>
        <button
          onClick={onClear}
          className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed bg-background px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <UserRound className="size-4" />
        Add customer (optional)
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Look up customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Phone number"
              value={phone}
              onChange={(e) => search(e.target.value)}
              autoFocus
            />

            {searching && <p className="text-sm text-muted-foreground">Searching…</p>}

            {matches.length > 0 && (
              <div className="space-y-1">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => attach(m)}
                    className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-medium">{m.name ?? "Unnamed"}</span>
                    <span className="text-muted-foreground">{m.phone}</span>
                  </button>
                ))}
              </div>
            )}

            {matches.length === 0 && phone.trim().length >= 3 && !searching && (
              <div className="space-y-2 rounded-md border border-dashed p-3">
                <p className="text-sm text-muted-foreground">No match — create a new customer.</p>
                <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
                <Button className="w-full" disabled={saving} onClick={() => attach()}>
                  {saving ? "Saving…" : "Create & attach"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
