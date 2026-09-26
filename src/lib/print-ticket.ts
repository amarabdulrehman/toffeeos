/**
 * Printing a ticket — receipt, bill, kitchen ticket, closing summary, no-sale slip — on a receipt
 * printer, so that it prints the ticket and stops.
 *
 * It used to print and keep feeding paper. Two reasons, both of which had to go:
 *
 * - The page never said how big the paper was. A roll printer's driver then falls back to its own
 *   default, which for a typical 80mm thermal printer is a "page" several metres long, so the
 *   printer fed blank paper until that page ran out.
 * - The print stylesheet only made the rest of the app invisible (visibility: hidden). Invisible
 *   is not gone: it still took up its full height, so the printed document was as long as the whole
 *   screen, not the ticket.
 *
 * So printing now copies the one ticket on screen into a container of its own directly under
 * <body>, takes everything else out of the layout entirely while printing (display: none, in
 * globals.css), and declares a page exactly the paper's width and the ticket's length. The printer
 * is told to print one page that long, prints it, and stops.
 *
 * The width is whatever this device's paper is — 58mm, 80mm or any other, set from the print
 * dialogs and remembered per device (see src/lib/paper-width.ts). The copy is laid out and scaled
 * to that paper's printable width, and measured there, since a narrower ticket is a longer one.
 *
 * The page is always longer than it is wide. A short kitchen ticket measured, say, 80mm wide by
 * 60mm long, and a page wider than it is long is a landscape page: the browser told the printer
 * "landscape" and the ticket came out turned on its side. Such a ticket gets a little more paper
 * below it instead.
 *
 * What the browser cannot do is choose the printer's paper. Chrome and Edge lay the page out at
 * the size declared here but print it on whatever paper size is selected for the printer — and a
 * receipt printer's usual default is a roll "page" about three metres long, which it feeds to the
 * end unless the driver trims blank paper. That is a setting on each till, done once; the steps
 * are in every print dialog (PrinterSetupHelp in src/components/print/ticket-preview.tsx).
 *
 * The same preparation runs on the browser's own Print (Ctrl+P / the share sheet), via the
 * beforeprint event, so there is no way to print a ticket that skips it.
 */

import { paperLayout, readPaperWidth, type PaperKind } from "@/lib/paper-width";

/** Paper left under the last line, so the cutter doesn't slice through it. */
const TAIL_MM = 8;
/** How much longer than wide a page always is — clearly portrait, whatever rounding a driver does. */
const PORTRAIT_MARGIN_MM = 10;
const PX_TO_MM = 25.4 / 96;

const ROOT_ID = "print-root";
const PAGE_STYLE_ID = "print-page-size";

/** The tidy-up after the last print, cancelled if another print starts first. */
let pendingCleanup: number | undefined;

/** The ticket currently on screen: the last visible `.print-area`, ignoring our own copy. */
function visibleTicket(): HTMLElement | null {
  const tickets = Array.from(document.querySelectorAll<HTMLElement>(".print-area")).filter(
    (el) => el.closest(`#${ROOT_ID}`) === null && el.getClientRects().length > 0
  );
  return tickets[tickets.length - 1] ?? null;
}

/** Removes the copy and the page size, so the next ordinary print is an ordinary print. */
export function clearPreparedTicket(): void {
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

/**
 * The page length, in whole millimetres, for a ticket this tall as laid out for print, on paper
 * this wide: the ticket plus room for the cutter, and always longer than the paper is wide, so the
 * page is portrait and the ticket prints the right way up.
 */
export function ticketPageHeightMm(heightPx: number, paperMm: number): number {
  return Math.max(Math.ceil(heightPx * PX_TO_MM) + TAIL_MM, paperMm + PORTRAIT_MARGIN_MM);
}

/** Which paper a ticket goes on: kitchen tickets say so (data-paper="kitchen"); the rest are receipts. */
function kindOf(ticket: HTMLElement): PaperKind {
  return ticket.dataset.paper === "kitchen" ? "kitchen" : "receipt";
}

function prepare(ticket: HTMLElement): void {
  window.clearTimeout(pendingCleanup);
  clearPreparedTicket();

  const paper = paperLayout(readPaperWidth(kindOf(ticket)));

  // The copy sits on a "sheet" exactly the printable width, centred on the page; inside it the
  // ticket is laid out at the width that wraps its lines right for this paper, then scaled to fit.
  // zoom, not transform: zoom changes the space the ticket takes up, so the sheet — and the page
  // measured from it — is the ticket's real printed length.
  const copy = ticket.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id"); // the original keeps its id; two in the document is invalid
  const sheet = document.createElement("div");
  sheet.className = "print-sheet";
  sheet.appendChild(copy);
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.appendChild(sheet);
  document.body.appendChild(root);

  const style = document.createElement("style");
  style.id = PAGE_STYLE_ID;
  const layoutRules =
    `#${ROOT_ID} .print-sheet { width: ${paper.printableMm}mm; margin: 0 auto; }\n` +
    // The ticket's own fixed width is for the screen; the long word or number that won't wrap
    // breaks rather than running off the paper.
    `#${ROOT_ID} .print-area { width: ${paper.layoutPx}px; zoom: ${paper.zoom}; margin: 0; overflow-wrap: anywhere; }`;
  style.textContent = layoutRules;
  document.head.appendChild(style);

  // Measured on the copy, laid out as it will print: the copy is display: none on screen, so it is
  // shown for a moment off-screen, measured, and hidden again. getBoundingClientRect is its full
  // height whatever scrolls or clips on screen.
  root.style.cssText = `display: block; position: absolute; left: -10000px; top: 0; width: ${paper.pageMm}mm; visibility: hidden;`;
  const heightMm = ticketPageHeightMm(sheet.getBoundingClientRect().height, paper.pageMm);
  root.removeAttribute("style");

  style.textContent = `@page { size: ${paper.pageMm}mm ${heightMm}mm; margin: 0; }\n${layoutRules}`;
}

/** Prints the ticket on screen — only it, on a page exactly its length. */
export function printTicket(): void {
  const ticket = visibleTicket();
  if (ticket) prepare(ticket);
  window.print();
}

// The browser's own Print goes through the same preparation. Installed once, when any screen that
// can print a ticket loads.
declare global {
  interface Window {
    __ticketPrintListeners?: boolean;
  }
}
if (typeof window !== "undefined" && !window.__ticketPrintListeners) {
  window.__ticketPrintListeners = true;
  window.addEventListener("beforeprint", () => {
    // Always from what is on screen now: a copy left from an earlier print must never be printed
    // in place of the page someone is actually looking at.
    const ticket = visibleTicket();
    if (ticket) prepare(ticket);
    else clearPreparedTicket();
  });
  // Not immediately: some browsers (Safari on iPad among them) report the print finished before
  // they have finished reading the page. The copy is invisible on screen, so a short wait costs
  // nothing, and beforeprint rebuilds it for the next print regardless.
  window.addEventListener("afterprint", () => {
    window.clearTimeout(pendingCleanup);
    pendingCleanup = window.setTimeout(clearPreparedTicket, 5000);
  });
}
