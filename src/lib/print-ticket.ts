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
 * globals.css), and declares a page exactly the ticket's width and length. The printer is told to
 * print one page that long, prints it, and stops.
 *
 * The same preparation runs on the browser's own Print (Ctrl+P / the share sheet), via the
 * beforeprint event, so there is no way to print a ticket that skips it.
 */

/** 80mm roll: the size nearly every café receipt printer here takes. */
const PAPER_WIDTH_MM = 80;
/** Paper left under the last line, so the cutter doesn't slice through it. */
const TAIL_MM = 8;
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

/** The page length, in whole millimetres, for a ticket this tall on screen. */
export function ticketPageHeightMm(heightPx: number): number {
  return Math.ceil(heightPx * PX_TO_MM) + TAIL_MM;
}

function prepare(ticket: HTMLElement): void {
  window.clearTimeout(pendingCleanup);
  clearPreparedTicket();

  // Measured on the original, which is laid out; the copy is display: none until printing starts.
  // getBoundingClientRect is the element's full height even when a scrolling dialog clips it.
  const heightMm = ticketPageHeightMm(ticket.getBoundingClientRect().height);

  const copy = ticket.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id"); // the original keeps its id; two in the document is invalid
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.appendChild(copy);
  document.body.appendChild(root);

  const style = document.createElement("style");
  style.id = PAGE_STYLE_ID;
  style.textContent = `@page { size: ${PAPER_WIDTH_MM}mm ${heightMm}mm; margin: 0; }`;
  document.head.appendChild(style);
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
