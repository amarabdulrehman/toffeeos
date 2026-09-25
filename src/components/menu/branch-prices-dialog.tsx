"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";

interface BranchPrice {
  branchId: string;
  branchName: string;
  pricePaisa: number | null;
}

/**
 * One dish, priced differently at each branch — the one in the expensive part of town charging
 * more. Blank means the menu price. Sizes and add-ons keep their own differences on top.
 */
export function BranchPricesDialog({
  item,
  onClose,
}: {
  /** Null closes the dialog. */
  item: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ basePricePaisa: number; branches: BranchPrice[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    fetch(`/api/menu-items/${item.id}/branch-prices`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.item) return;
        setData({ basePricePaisa: d.item.basePricePaisa, branches: d.branches });
        setDraft(Object.fromEntries((d.branches as BranchPrice[]).map((b) => [b.branchId, b.pricePaisa === null ? "" : String(b.pricePaisa / 100)])));
      })
      .catch(() => toast.error("Could not load branch prices."));
    return () => {
      cancelled = true;
    };
  }, [item]);

  async function save(branch: BranchPrice) {
    if (!item) return;
    const raw = (draft[branch.branchId] ?? "").trim();
    const pricePaisa = raw === "" ? null : Math.round(Number(raw) * 100);
    if (pricePaisa !== null && !(pricePaisa >= 0)) {
      toast.error("That isn't a price.");
      return;
    }
    setSaving(branch.branchId);
    const res = await fetch(`/api/menu-items/${item.id}/branch-prices`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: branch.branchId, pricePaisa }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) {
      toast.error(body.error ?? "Could not save.");
      return;
    }
    toast.success(pricePaisa === null ? `${branch.branchName} uses the menu price.` : `${branch.branchName}: ${formatPkr(pricePaisa)}.`);
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Branch prices — {item?.name}</DialogTitle>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Menu price {formatPkr(data.basePricePaisa)}. Leave a branch blank to use it there.
            </p>
            {data.branches.map((b) => (
              <div key={b.branchId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">{b.branchName}</span>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  className="w-28"
                  placeholder={String(data.basePricePaisa / 100)}
                  aria-label={`Price at ${b.branchName}`}
                  value={draft[b.branchId] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [b.branchId]: e.target.value }))}
                />
                <Button size="sm" variant="outline" disabled={saving === b.branchId} onClick={() => save(b)}>
                  Save
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
