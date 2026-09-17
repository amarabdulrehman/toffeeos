"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";

/**
 * The two editors for sizes and add-ons.
 *
 * Both concepts have been in the schema and priced correctly at the till since the beginning, with
 * no API and no screen behind them — the only way to give an item a second size was to write to the
 * database by hand. This is that screen.
 */

export interface OptionsItem {
  id: string;
  name: string;
  basePricePaisa: number;
}

interface VariantRow {
  id: string;
  name: string;
  pricePaisa: number;
  isDefault: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: string; priceDeltaPaisa: number }[];
  attachedCount: number;
}

/** Rupees typed into a box -> paisa. Everything priced in this product is an integer number of
 * paisa, and the pricing engine's assertInt rejects a float outright, so round here and round once. */
const toPaisa = (rupees: string) => Math.round(Number(rupees) * 100);

/** "choose 1", "choose 1–3", "optional, up to 6" — the rule in the words a person would use. */
function ruleLabel(minSelect: number, maxSelect: number): string {
  if (minSelect === 0) return maxSelect === 1 ? "optional" : `optional, up to ${maxSelect}`;
  if (minSelect === maxSelect) return `choose ${minSelect}`;
  return `choose ${minSelect}–${maxSelect}`;
}

function priceLabel(deltaPaisa: number): string {
  if (deltaPaisa === 0) return "no charge";
  return `${deltaPaisa > 0 ? "+" : "−"}${formatPkr(Math.abs(deltaPaisa))}`;
}

/**
 * Sizes and add-ons for one menu item.
 *
 * Sizes are entered as the price the customer pays, not as the difference from the base price that
 * the schema actually stores — nobody types a menu in by working out deltas. The conversion happens
 * in src/server/menu-options.ts; the one consequence that leaks is explained under the list, since
 * raising the item's base price raises every size with it.
 */
export function ItemOptionsDialog({ item, onClose }: { item: OptionsItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Sizes &amp; add-ons — {item?.name}</DialogTitle>
        </DialogHeader>
        {/* Keyed on the item so switching items rebuilds this by mounting, rather than by an effect
            that clears the previous item's half-typed size after it has already rendered. */}
        {item && <ItemOptionsBody key={item.id} item={item} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ItemOptionsBody({ item, onClose }: { item: OptionsItem; onClose: () => void }) {
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [attached, setAttached] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const itemId = item.id;

  const load = useCallback(async () => {
    try {
      const [v, g, a] = await Promise.all([
        fetch(`/api/menu-items/${itemId}/variants`),
        fetch("/api/modifier-groups"),
        fetch(`/api/menu-items/${itemId}/modifier-groups`),
      ]);
      const vb = await v.json().catch(() => ({}));
      if (!v.ok) {
        setError(vb.error ?? "Could not load this item's options.");
        return;
      }
      // A failed load used to fall back to an empty list, which renders exactly like "this item has
      // no sizes and there are no groups" — the most misleading thing this screen could say, since
      // the obvious next move is to create duplicates of what is already there.
      if (!g.ok || !a.ok) {
        setError("Could not load the add-on groups. Reopen this to try again.");
        return;
      }
      setError(null);
      setVariants(vb.variants ?? []);
      setGroups((await g.json()).groups ?? []);
      setAttached((await a.json()).groupIds ?? []);
    } catch {
      setError("Could not load this item's options.");
    }
  }, [itemId]);

  useEffect(() => {
    // Async IIFE, matching the other dialogs on this screen: the effect itself sets no state, so
    // there is no synchronous cascade — every setState below happens after an await.
    (async () => {
      await load();
    })();
  }, [load]);

  async function addSize() {
    if (!name.trim() || price === "") return;
    setBusy(true);
    const res = await fetch(`/api/menu-items/${itemId}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), pricePaisa: toPaisa(price) }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not add that size.");
      return;
    }
    setName("");
    setPrice("");
    load();
  }

  async function removeSize(id: string) {
    const res = await fetch(`/api/variants/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove that size.");
      return;
    }
    load();
  }

  async function makeDefault(id: string) {
    const res = await fetch(`/api/variants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    if (!res.ok) {
      toast.error("Could not set the default size.");
      return;
    }
    load();
  }

  async function toggleGroup(groupId: string) {
    const next = attached.includes(groupId) ? attached.filter((id) => id !== groupId) : [...attached, groupId];
    const res = await fetch(`/api/menu-items/${itemId}/modifier-groups`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds: next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not change the add-ons.");
      return;
    }
    setAttached(next);
  }

  return (
    <>
        {error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Lock className="size-6 text-muted-foreground/50" />
            {error}
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sizes</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter what each size costs. With no sizes the item rings up at its base price of{" "}
                {formatPkr(item.basePricePaisa)}, and sizes move with that base price if you change it later.
              </p>

              <div className="mt-3 space-y-2">
                {variants.length === 0 && <p className="text-sm text-muted-foreground">No sizes — one price only.</p>}
                {variants.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 rounded-xl border bg-muted/20 p-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="font-medium">{v.name}</span>
                      <span className="tabular-nums text-muted-foreground">{formatPkr(v.pricePaisa)}</span>
                      {v.isDefault && <Badge variant="secondary">Default</Badge>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {!v.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => makeDefault(v.id)}>
                          Make default
                        </Button>
                      )}
                      <button
                        aria-label={`Remove ${v.name}`}
                        onClick={() => removeSize(v.id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="size-4" />
                      </button>
                    </span>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Input
                    aria-label="Size name"
                    placeholder="Size name, e.g. 16oz"
                    className="min-w-40 flex-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Input
                    type="number"
                    aria-label="Size price"
                    placeholder="Price"
                    className="w-28"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <Button onClick={addSize} disabled={busy || !name.trim() || price === ""}>
                    Add
                  </Button>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Add-ons</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Tick the groups this item offers. Groups are shared across the whole menu — edit them under
                &ldquo;Add-on groups&rdquo;.
              </p>

              <div className="mt-3 space-y-2">
                {groups.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No add-on groups yet. Create one under &ldquo;Add-on groups&rdquo; first.
                  </p>
                )}
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border bg-muted/20 p-2.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      checked={attached.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{g.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        — {g.modifiers.length} option{g.modifiers.length === 1 ? "" : "s"},{" "}
                        {ruleLabel(g.minSelect, g.maxSelect)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
    </>
  );
}

/**
 * Add-on groups, which are tenant-wide and shared on purpose: one "House Dips" offered by every
 * fries item, rather than a copy per item that has to be corrected six times when the price moves.
 */
export function ModifierGroupsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Add-on groups</DialogTitle>
        </DialogHeader>
        {open && <ModifierGroupsBody onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ModifierGroupsBody({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [minSelect, setMinSelect] = useState("0");
  const [maxSelect, setMaxSelect] = useState("1");
  const [optionName, setOptionName] = useState<Record<string, string>>({});
  const [optionPrice, setOptionPrice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/modifier-groups");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not load add-on groups.");
      return;
    }
    setError(null);
    setGroups(body.groups ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function createGroup() {
    const res = await fetch("/api/modifier-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), minSelect: Number(minSelect), maxSelect: Number(maxSelect) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not create that group.");
      return;
    }
    setName("");
    setMinSelect("0");
    setMaxSelect("1");
    load();
  }

  async function addOption(groupId: string) {
    const optName = (optionName[groupId] ?? "").trim();
    const optPrice = optionPrice[groupId] ?? "";
    if (!optName || optPrice === "") return;
    const res = await fetch(`/api/modifier-groups/${groupId}/modifiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: optName, priceDeltaPaisa: toPaisa(optPrice) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not add that option.");
      return;
    }
    setOptionName((p) => ({ ...p, [groupId]: "" }));
    setOptionPrice((p) => ({ ...p, [groupId]: "" }));
    load();
  }

  async function removeOption(modifierId: string) {
    const res = await fetch(`/api/modifiers/${modifierId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not remove that option.");
      return;
    }
    load();
  }

  async function removeGroup(groupId: string) {
    const res = await fetch(`/api/modifier-groups/${groupId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove that group.");
      return;
    }
    load();
  }

  return (
    <>
        {error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Lock className="size-6 text-muted-foreground/50" />
            {error}
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-xs text-muted-foreground">
              A group is a question the till asks — &ldquo;Hot or Iced?&rdquo;, &ldquo;Any dips?&rdquo;. The minimum
              and maximum are enforced when the order is placed, so a group set to choose one cannot be skipped.
            </p>

            {groups.length === 0 && <p className="text-sm text-muted-foreground">No groups yet.</p>}

            {groups.map((g) => (
              <div key={g.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {ruleLabel(g.minSelect, g.maxSelect)}, on {g.attachedCount} item
                      {g.attachedCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <button
                    aria-label={`Remove ${g.name}`}
                    onClick={() => removeGroup(g.id)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="mt-2 space-y-1.5">
                  {g.modifiers.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-sm"
                    >
                      <span className="min-w-0">{m.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-muted-foreground">{priceLabel(m.priceDeltaPaisa)}</span>
                        <button
                          aria-label={`Remove ${m.name}`}
                          onClick={() => removeOption(m.id)}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    aria-label={`New option for ${g.name}`}
                    placeholder="Option, e.g. Extra shot"
                    className="min-w-36 flex-1"
                    value={optionName[g.id] ?? ""}
                    onChange={(e) => setOptionName((p) => ({ ...p, [g.id]: e.target.value }))}
                  />
                  <Input
                    type="number"
                    aria-label={`Price for the new ${g.name} option`}
                    placeholder="+ Rs"
                    className="w-24"
                    value={optionPrice[g.id] ?? ""}
                    onChange={(e) => setOptionPrice((p) => ({ ...p, [g.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" onClick={() => addOption(g.id)}>
                    Add
                  </Button>
                </div>
              </div>
            ))}

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="group-name">New group</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="group-name"
                  placeholder="e.g. House Dips"
                  className="min-w-40 flex-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  type="number"
                  aria-label="Minimum choices"
                  title="Minimum choices"
                  className="w-20"
                  value={minSelect}
                  onChange={(e) => setMinSelect(e.target.value)}
                />
                <Input
                  type="number"
                  aria-label="Maximum choices"
                  title="Maximum choices"
                  className="w-20"
                  value={maxSelect}
                  onChange={(e) => setMaxSelect(e.target.value)}
                />
                <Button onClick={createGroup} disabled={!name.trim()}>
                  Create
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Minimum and maximum choices per order line.</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
    </>
  );
}
