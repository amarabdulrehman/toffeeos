"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";

/**
 * Importing a menu from a spreadsheet.
 *
 * Always previews before it writes. Seventy-eight items is the operation nobody wants to discover
 * was wrong afterwards, and the owner should see "4 new, 74 already here" before agreeing to
 * anything — those are very different things to say yes to.
 *
 * Errors are shown with their line numbers and the import button stays disabled while any remain,
 * because a half-imported menu from an uncorrected file is the worst outcome: fix the spreadsheet,
 * re-run, and now you have to work out which half went in the first time.
 */

interface Summary {
  categoriesCreated: string[];
  itemsCreated: number;
  variantsCreated: number;
  itemsUpdated: { category: string; name: string; changes: string[] }[];
  skipped: { category: string; name: string }[];
  leftAlone: { category: string; name: string; reason: string }[];
  errors: { line: number; message: string }[];
  items?: {
    category: string;
    name: string;
    pricePaisa: number;
    sizes: string[];
    status: "new" | "update" | "same" | "leftAlone";
    notes: string[];
  }[];
}

const STATUS_TEXT: Record<"update" | "same" | "leftAlone", string> = {
  update: "will change",
  same: "already up to date",
  leftAlone: "left as it is",
};

const TEMPLATE = `Category,Item,Size,Price,Description
Coffee,Latte,12oz,599,
Coffee,Latte,16oz,699,
Fries,Plain Fries,,549,Crispy and salted`;

export function MenuImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!csv.trim()) return;
    setBusy(true);
    const res = await fetch("/api/menu/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, dryRun }),
    });
    setBusy(false);

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not read that file.");
      return;
    }

    const summary = body.summary as Summary;
    if (dryRun) {
      setPreview(summary);
      return;
    }

    const parts = [
      summary.itemsCreated > 0 && `added ${summary.itemsCreated} item${summary.itemsCreated === 1 ? "" : "s"}`,
      summary.itemsUpdated.length > 0 &&
        `updated ${summary.itemsUpdated.length} item${summary.itemsUpdated.length === 1 ? "" : "s"}`,
      summary.variantsCreated > 0 && `${summary.variantsCreated} new size${summary.variantsCreated === 1 ? "" : "s"}`,
    ].filter(Boolean) as string[];
    const text = parts.join(", ");
    toast.success(text ? text[0].toUpperCase() + text.slice(1) : "Nothing to change");
    onImported();
    close();
  }

  function close() {
    setCsv("");
    setPreview(null);
    onClose();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPreview(null);
    setCsv(await file.text());
  }

  const hasErrors = (preview?.errors.length ?? 0) > 0;
  const hasWork = !!preview && (preview.itemsCreated > 0 || preview.itemsUpdated.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Import a menu</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="menu-csv-file">Spreadsheet (CSV)</Label>
            <input
              id="menu-csv-file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">
              Columns: <code>Category, Item, Size, Price, Description</code>. Leave Size blank for a single
              price; repeat an item with different sizes to give it a size picker. Prices in rupees. Items
              already on the menu take the file&apos;s prices and descriptions; nothing is ever deleted.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="menu-csv-text">Or paste it</Label>
            <textarea
              id="menu-csv-text"
              rows={7}
              spellCheck={false}
              placeholder={TEMPLATE}
              className="w-full rounded-xl border border-border/70 bg-card p-3 font-mono text-xs"
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
            />
          </div>

          {preview && (
            <section className="space-y-3 rounded-xl border p-3">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                What this will do
              </h3>

              {hasErrors ? (
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {preview.errors.length === 1
                        ? "1 row needs fixing."
                        : `${preview.errors.length} rows need fixing.`}{" "}
                      Nothing has been changed.
                    </span>
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                    {preview.errors.map((e) => (
                      <li key={`${e.line}-${e.message}`} className="text-muted-foreground">
                        <span className="font-medium text-foreground">Line {e.line}</span> — {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      <b className="tabular-nums">{preview.itemsCreated}</b> new item
                      {preview.itemsCreated === 1 ? "" : "s"}
                    </span>
                    <span>
                      <b className="tabular-nums">{preview.variantsCreated}</b> size
                      {preview.variantsCreated === 1 ? "" : "s"}
                    </span>
                    <span>
                      <b className="tabular-nums">{preview.categoriesCreated.length}</b> new categor
                      {preview.categoriesCreated.length === 1 ? "y" : "ies"}
                    </span>
                    {preview.itemsUpdated.length > 0 && (
                      <span>
                        <b className="tabular-nums">{preview.itemsUpdated.length}</b> to update
                      </span>
                    )}
                    {preview.skipped.length > 0 && (
                      <span className="text-muted-foreground">
                        <b className="tabular-nums">{preview.skipped.length}</b> already up to date
                      </span>
                    )}
                    {preview.leftAlone.length > 0 && (
                      <span className="text-warning-foreground">
                        <b className="tabular-nums">{preview.leftAlone.length}</b> left as they are — see below
                      </span>
                    )}
                  </div>

                  {preview.items && preview.items.length > 0 && (
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                      {preview.items.map((i) => (
                        <li key={`${i.category}::${i.name}`} className={i.status === "same" ? "text-muted-foreground" : ""}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0">
                              <span className="text-muted-foreground">{i.category} · </span>
                              {i.name}
                              {i.sizes.length > 0 && (
                                <span className="text-muted-foreground"> ({i.sizes.join(", ")})</span>
                              )}
                            </span>
                            <span
                              className={`shrink-0 tabular-nums ${i.status === "leftAlone" ? "text-warning-foreground" : ""}`}
                            >
                              {i.status === "new" ? formatPkr(i.pricePaisa) : STATUS_TEXT[i.status]}
                            </span>
                          </div>
                          {i.notes.length > 0 && <div className="pl-3 text-muted-foreground">{i.notes.join(" · ")}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button variant="outline" disabled={busy || !csv.trim()} onClick={() => send(true)}>
            Check it
          </Button>
          <Button
            disabled={busy || !preview || hasErrors || !hasWork}
            title={
              !preview
                ? "Check the file first"
                : hasErrors
                  ? "Fix the rows listed above first"
                  : !hasWork
                    ? "The menu already matches this file"
                    : undefined
            }
            onClick={() => send(false)}
          >
            <Upload className="size-4" />
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
