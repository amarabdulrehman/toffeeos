"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
          <DialogTitle>{item?.name} — choose an option</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {item?.variants.map((v) => (
            <Button
              key={v.id}
              variant="outline"
              className="justify-between"
              onClick={() => onPick(v.id)}
            >
              <span>{v.name}</span>
              <span className="font-semibold">{formatPkr(item.basePricePaisa + v.priceDeltaPaisa)}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
