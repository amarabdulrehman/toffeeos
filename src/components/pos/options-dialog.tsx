"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatPkr } from "@/lib/money";
import type { MenuItemDto } from "./types";

/**
 * The one dialog that asks everything a line needs before it can be rung up: which size, and which
 * add-ons.
 *
 * It replaces a size-only picker. Add-on groups were fetched, typed and handed to this component's
 * predecessor, which ignored them — so a menu could carry a dips list or an extra-shot charge that
 * no cashier had any way to select. The groups also carry a minimum and a maximum, which the server
 * now enforces, so the button below stays disabled until every required choice is made rather than
 * sending an order the till already knows will be refused.
 */
export function OptionsDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuItemDto | null;
  onClose: () => void;
  onConfirm: (choice: { variantId?: string; modifierIds: string[] }) => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{item?.name}</DialogTitle>
        </DialogHeader>
        {/* Keyed on the item so a fresh set of choices is built by mounting, rather than by an
            effect that resets state after the dialog has already rendered the last item's. */}
        {item && <OptionsBody key={item.id} item={item} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  );
}

function OptionsBody({
  item,
  onConfirm,
}: {
  item: MenuItemDto;
  onConfirm: (choice: { variantId?: string; modifierIds: string[] }) => void;
}) {
  // Open on the item's default size, so the common case is one tap on Add.
  const [variantId, setVariantId] = useState<string | undefined>(
    () => (item.variants.find((v) => v.isDefault) ?? item.variants[0])?.id
  );
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const groups = item.modifierGroups;
  const modifierIds = useMemo(() => Object.values(picked).flat(), [picked]);

  const variantDelta = item.variants.find((v) => v.id === variantId)?.priceDeltaPaisa ?? 0;
  const modifierDelta = groups
    .flatMap((g) => g.modifiers)
    .filter((m) => modifierIds.includes(m.id))
    .reduce((sum, m) => sum + m.priceDeltaPaisa, 0);
  const unitPrice = item.basePricePaisa + variantDelta + modifierDelta;

  const unmet = groups.filter((g) => (picked[g.id]?.length ?? 0) < g.minSelect);

  function toggle(groupId: string, modifierId: string, maxSelect: number) {
    setPicked((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(modifierId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== modifierId) };
      }
      // At a limit of one, tapping another option swaps rather than refusing — that is what the
      // cashier means by tapping it, and a dialog that silently ignores a tap feels broken.
      if (maxSelect === 1) return { ...prev, [groupId]: [modifierId] };
      if (current.length >= maxSelect) return prev;
      return { ...prev, [groupId]: [...current, modifierId] };
    });
  }

  return (
    <>
        <div className="space-y-5">
          {item.variants.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Size</h3>
              <div className="grid gap-2">
                {item.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={variantId === v.id}
                    onClick={() => setVariantId(v.id)}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      variantId === v.id
                        ? "border-primary bg-primary/5 shadow-xs"
                        : "border-border/70 bg-card hover:border-primary/50"
                    }`}
                  >
                    <span className="font-medium">{v.name}</span>
                    <span className="font-heading font-semibold text-primary tabular-nums">
                      {formatPkr(item.basePricePaisa + v.priceDeltaPaisa)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {groups.map((group) => {
            const chosen = picked[group.id] ?? [];
            const rule =
              group.minSelect > 0 && group.maxSelect === group.minSelect
                ? `Choose ${group.minSelect}`
                : group.minSelect > 0
                  ? `Choose ${group.minSelect}–${group.maxSelect}`
                  : `Optional, up to ${group.maxSelect}`;
            return (
              <section key={group.id}>
                <h3 className="mb-2 flex items-baseline justify-between gap-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <span>{group.name}</span>
                  <span className={`font-normal normal-case ${chosen.length < group.minSelect ? "text-destructive" : ""}`}>
                    {rule}
                  </span>
                </h3>
                <div className="grid gap-2">
                  {group.modifiers.map((m) => {
                    const on = chosen.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(group.id, m.id, group.maxSelect)}
                        className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-left transition-all ${
                          on ? "border-primary bg-primary/5 shadow-xs" : "border-border/70 bg-card hover:border-primary/50"
                        }`}
                      >
                        <span>{m.name}</span>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {m.priceDeltaPaisa === 0
                            ? "—"
                            : `${m.priceDeltaPaisa > 0 ? "+" : "−"}${formatPkr(Math.abs(m.priceDeltaPaisa))}`}
                        </span>
                      </button>
                    );
                  })}
                  {group.modifiers.length === 0 && (
                    <p className="text-sm text-muted-foreground">This group has no options yet.</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <DialogFooter className="items-center justify-between gap-3 sm:justify-between">
          <span className="font-heading text-lg font-semibold tabular-nums">{formatPkr(unitPrice)}</span>
          <Button
            disabled={unmet.length > 0}
            title={unmet.length > 0 ? `Still to choose: ${unmet.map((g) => g.name).join(", ")}` : undefined}
            onClick={() => onConfirm({ variantId, modifierIds })}
          >
            Add to order
          </Button>
        </DialogFooter>
    </>
  );
}
