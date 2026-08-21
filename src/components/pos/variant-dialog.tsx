"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";
import type { MenuItemDto } from "./types";

export function VariantDialog({
  item,
  onClose,
  onPick,
}: {
  item: MenuItemDto | null;
  onClose: () => void;
  onPick: (variantId: string) => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">{item?.name} — choose an option</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {item?.variants.map((v) => (
            <button
              key={v.id}
              onClick={() => onPick(v.id)}
              className="flex items-center justify-between rounded-xl border border-border/70 bg-card px-4 py-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md active:translate-y-0"
            >
              <span className="font-medium">{v.name}</span>
              <span className="font-heading font-semibold text-primary">
                {formatPkr(item.basePricePaisa + v.priceDeltaPaisa)}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
