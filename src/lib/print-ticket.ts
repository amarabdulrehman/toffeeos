/**
 * Printing a ticket — receipt, bill, kitchen ticket, closing summary, no-sale slip — on a receipt
 * printer, so that it prints the ticket and stops.
 *
 * Printing copies the one ticket on screen into a container of its own directly under <body>, and
 * takes everything else out of the layout entirely while printing (display: none, in globals.css).
 * The rule this replaced used visibility: hidden, which left the whole app's height in the printed
 * document.
 *
 * The page is left the size of the paper selected for the printer, portrait, with no margins:
 * `@page { size: portrait; margin: 0 }`. An earlier version declared a page exactly the ticket's
 * length instead, and on a real receipt printer (a Black Copper 80, from Chrome, 27 September 2026)
 * it made things worse:
 *
 * - Chrome prints on the paper chosen in its print window whatever size the page declares. It laid
 *   the declared page out, centred it on that paper — the ticket landed halfway down — and printed
 *   its own header and footer (date, title, web address, page number) on the paper's edges.
 * - On a receipt printer's usual paper, a roll "page" about three metres long, that footer is three
 *   metres down. The printer fed blank paper all the way there to print it: the paper that "never
 *   stops".
 * - A short kitchen ticket declared a page wider than it was long, which Chrome sends as landscape:
 *   the ticket came out on its side.
 *
 * With no size declared, the page is the paper: the ticket sits at the top, nothing is printed at
 * the far end, and a printer that trims blank paper stops after the last line. With no margins
 * Chrome has nowhere to put its header and footer. Portrait whatever the print window last said.
 *
 * How long each "page" is remains the printer's paper-size setting, which a web page cannot choose.
 * The steps for each till are beside the Print button (PrinterSetupHelp in
 * src/components/print/ticket-preview.tsx).
 *
 * The ticket's width is whatever this device's paper is — 58mm, 80mm or any other, set from the
 * print dialogs and remembered per device (see src/lib/paper-width.ts). The copy is laid out and
 * scaled to that paper's printable width and centred across it.
 *
 * The same preparation runs on the browser's own Print (Ctrl+P / the share sheet), via the
 * beforeprint event, so there is no way to print a ticket that skips it.
 */

import { paperLayout, readPaperWidth, type PaperKind } from "@/lib/paper-width";

const ROOT_ID = "print-root";
const PAGE_STYLE_ID = "print-page-size";

/**
 * The page rule while a ticket prints. No size: the paper selected for the printer is the page (a
 * declared size is centred on that paper, footer and all). No margins: nowhere for the browser's
 * own header and footer. Portrait: never turned on its side.
 */
export const TICKET_PAGE_RULE = "@page { size: portrait; margin: 0; }";

/** The tidy-up after the last print, cancelled if another print starts first. */
let pendingCleanup: number | undefined;

/** The ticket currently on screen: the last visible `.print-area`, ignoring our own copy. */
function visibleTicket(): HTMLElement | null {
  const tickets = Array.from(document.querySelectorAll<HTMLElement>(".print-area")).filter(
    (el) => el.closest(`#${ROOT_ID}`) === null && el.getClientRects().length > 0
  );
  return tickets[tickets.length - 1] ?? null;
}

/** Removes the copy and the page rule, so the next ordinary print is an ordinary print. */
export function clearPreparedTicket(): void {
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

/** Which paper a ticket goes on: kitchen tickets say so (data-paper="kitchen"); the rest are receipts. */
function kindOf(ticket: HTMLElement): PaperKind {
  return ticket.dataset.paper === "kitchen" ? "kitchen" : "receipt";
}

function prepare(ticket: HTMLElement): void {
  window.clearTimeout(pendingCleanup);
  clearPreparedTicket();

  const paper = paperLayout(readPaperWidth(kindOf(ticket)));

  // The copy sits on a "sheet" exactly the printable width, centred across the paper; inside it the
  // ticket is laid out at the width that wraps its lines right for this paper, then scaled to fit.
  // zoom, not transform: zoom changes the space the ticket takes up, so nothing overlaps or spills.
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
  style.textContent =
    `${TICKET_PAGE_RULE}\n` +
    `#${ROOT_ID} .print-sheet { width: ${paper.printableMm}mm; margin: 0 auto; }\n` +
    // The ticket's own fixed width is for the screen; the long word or number that won't wrap
    // breaks rather than running off the paper.
    `#${ROOT_ID} .print-area { width: ${paper.layoutPx}px; zoom: ${paper.zoom}; margin: 0; overflow-wrap: anywhere; }`;
  document.head.appendChild(style);
}

/** Prints the ticket on screen — only it, at the top of the paper. */
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
