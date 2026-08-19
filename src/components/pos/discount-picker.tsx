"use client";

import { useState } from "react";
import { Percent, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Discount, DiscountType } from "./types";

export function DiscountPicker({
  discount,
  onApply,
  onClear,
}: {
  discount: Discount | null;
  onApply: (d: Discount) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DiscountType>("PERCENT");
  const [value, setValue] = useState("");

  function apply() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    onApply({ type, value: type === "PERCENT" ? Math.round(n * 100) : Math.round(n * 100) });
    setOpen(false);
    setValue("");
  }

  if (discount) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Percent className="size-4 text-muted-foreground" />
          <span className="font-medium">
            {discount.type === "PERCENT" ? `${(discount.value / 100).toFixed(0)}% off` : `Rs ${(discount.value / 100).toFixed(0)} off`}
          </span>
        </div>
        <button onClick={onClear} className="text-muted-foreground transition-colors hover:text-destructive">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50"
      >
        <Percent className="size-4" />
        Apply discount (optional)
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply order discount</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Select value={type} onValueChange={(v) => v && setType(v as DiscountType)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">% off</SelectItem>
                <SelectItem value="FIXED">Rs off</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder={type === "PERCENT" ? "e.g. 10" : "e.g. 200"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <Button onClick={apply}>Apply</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
