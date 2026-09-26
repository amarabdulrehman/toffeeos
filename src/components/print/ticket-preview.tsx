"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  COMMON_PAPER_MM,
  PAPER_MAX_MM,
  PAPER_MIN_MM,
  paperLayout,
  setPaperWidth,
  usePaperWidth,
  type PaperKind,
} from "@/lib/paper-width";

/**
 * A ticket in a print dialog, with this device's paper width above it.
 *
 * The width is chosen here, where someone is about to print, rather than in a settings screen
 * nobody opens until the prices have already run off the paper: 58mm, 80mm, or any other width in
 * whole millimetres. It is remembered on this device (see src/lib/paper-width.ts), for receipts
 * and kitchen tickets separately.
 *
 * The ticket below is laid out at the width it will print at, so its lines wrap here exactly where
 * they will wrap on the paper. It is not drawn to scale — a 58mm ticket's type would be hard to
 * read on a screen — only to the same line breaks; a wide roll's is shrunk to fit the dialog.
 */

/** About as wide as a ticket can be shown in a print dialog without scrolling sideways. */
const PREVIEW_MAX_PX = 290;

export function TicketPreview({
  kind,
  children,
  className,
}: {
  kind: PaperKind;
  children: ReactNode;
  className?: string;
}) {
  const width = usePaperWidth(kind);
  const { layoutPx } = paperLayout(width);
  const previewZoom = Math.min(1, PREVIEW_MAX_PX / layoutPx);
  return (
    <div className="space-y-2">
      <PaperWidthPicker kind={kind} width={width} />
      <div
        className={cn("ticket-preview max-h-[60vh] overflow-y-auto rounded-lg border bg-white p-4", className)}
        style={{ "--ticket-width": `${layoutPx}px`, "--ticket-preview-zoom": previewZoom } as CSSProperties}
      >
        {children}
      </div>
      <PrinterSetupHelp />
    </div>
  );
}

/**
 * What to set on the till, once, when the printer feeds blank paper after the ticket.
 *
 * The page cannot fix this itself: Chrome and Edge print on the paper size selected for the
 * printer, whatever the page declares, and a receipt printer's usual default is a roll "page"
 * about three metres long. So the fix is where the paper size lives — the browser's print window
 * (remembered per printer) and the printer's own preferences (the option that trims the blank
 * paper after the last line). Here, beside the Print button, because that is where someone is
 * standing when the paper starts pouring out.
 */
function PrinterSetupHelp() {
  return (
    <details className="rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Printer keeps feeding blank paper?</summary>
      <p className="mt-2 text-muted-foreground">Set up each till once:</p>
      <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>
          In the print window, open <strong className="text-foreground">More settings</strong>. Set{" "}
          <strong className="text-foreground">Paper size</strong> to your roll&apos;s size with the shortest length
          listed — for example <strong className="text-foreground">80 x 297 mm</strong>, not 80 x 3276 mm — and{" "}
          <strong className="text-foreground">Margins</strong> to None. The browser remembers this for the printer.
        </li>
        <li>
          To stop right after the ticket: in Windows, open Settings → Printers &amp; scanners → your receipt printer
          → <strong className="text-foreground">Printing preferences</strong>, and turn on the option called something
          like <strong className="text-foreground">Paper saving</strong>,{" "}
          <strong className="text-foreground">Paper reduction (bottom margin)</strong> or{" "}
          <strong className="text-foreground">Blank skip</strong>.
        </li>
        <li>Check that Paper, above, matches the roll: 58 mm or 80 mm.</li>
      </ol>
    </details>
  );
}

function isPrintableWidth(text: string): boolean {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= PAPER_MIN_MM && n <= PAPER_MAX_MM;
}

function PaperWidthPicker({ kind, width }: { kind: PaperKind; width: number }) {
  const common = (COMMON_PAPER_MM as readonly number[]).includes(width);
  const [otherChosen, setOtherChosen] = useState(false);
  // What is being typed, until it is a width that can be used; null shows the width in use.
  const [draft, setDraft] = useState<string | null>(null);
  const showOther = otherChosen || !common;
  const draftInvalid = draft !== null && !isPrintableWidth(draft);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label="Paper width">
        <span className="mr-1 text-muted-foreground">Paper</span>
        {COMMON_PAPER_MM.map((mm) => {
          const on = !showOther && width === mm;
          return (
            <Button
              key={mm}
              type="button"
              size="sm"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              onClick={() => {
                setOtherChosen(false);
                setDraft(null);
                setPaperWidth(kind, mm);
              }}
            >
              {mm} mm
            </Button>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant={showOther ? "default" : "outline"}
          aria-pressed={showOther}
          onClick={() => setOtherChosen(true)}
        >
          Other
        </Button>
        {showOther && (
          <span className="flex items-center gap-1">
            <Input
              type="number"
              inputMode="numeric"
              min={PAPER_MIN_MM}
              max={PAPER_MAX_MM}
              step={1}
              aria-label="Paper width in millimetres"
              aria-invalid={draftInvalid || undefined}
              className="h-8 w-20"
              autoFocus={otherChosen && common}
              value={draft ?? String(width)}
              onChange={(e) => {
                const text = e.target.value;
                setDraft(text);
                // Used as soon as it is a width that can be printed on: typing 112 passes through
                // 1 and 11 on the way, and neither should reach the printer.
                if (isPrintableWidth(text)) setPaperWidth(kind, Number(text));
              }}
              onBlur={() => setDraft(null)}
            />
            <span className="text-muted-foreground">mm</span>
          </span>
        )}
      </div>
      {draftInvalid && (
        <p className="text-xs text-destructive" role="alert">
          A whole number of millimetres, {PAPER_MIN_MM} to {PAPER_MAX_MM}. Printing uses {width} mm until then.
        </p>
      )}
    </div>
  );
}
