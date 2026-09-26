"use client";

import { useSyncExternalStore } from "react";

/**
 * How wide the printer's paper is, and how a ticket is laid out to fit it.
 *
 * Tickets were drawn for 80mm rolls only. On a 58mm printer the right-hand column — the prices —
 * ran off the edge of the paper, and on anything else the driver guessed. There is no way for a web
 * page to ask a printer how wide its paper is, so each device says so, once, from any print dialog,
 * and it is remembered there: 58mm, 80mm, or any width in whole millimetres.
 *
 * Remembered per device, since that is where the printer is plugged in, and separately for
 * receipts and kitchen tickets, since a till that prints both often sends them to two printers.
 * Kept in localStorage, wrapped so a private window or blocked storage simply means 80mm.
 *
 * Fitting a ticket to a width does two things at once:
 *
 * - It prints inside the paper's printable area. A roll printer can't print right to the edge —
 *   an 80mm printer prints 72mm, a 58mm one 48mm — so the ticket keeps a margin on each side
 *   instead of losing its first and last characters to it.
 * - It keeps the text a readable size. Narrower paper gets smaller type, down to about a 58mm
 *   printer's own (32 characters a line), and below that the lines wrap instead of the type
 *   shrinking further. Wider paper keeps the usual type and gets more on each line, the way a
 *   wide roll printer's own font does, up to a limit — a receipt across a whole A4 sheet helps
 *   nobody, and larger type would only use more paper.
 */

export type PaperKind = "receipt" | "kitchen";

export const PAPER_MIN_MM = 40;
export const PAPER_MAX_MM = 210;
export const DEFAULT_PAPER_MM = 80;
/** The two sizes nearly every receipt printer takes, offered as one tap. */
export const COMMON_PAPER_MM = [58, 80] as const;

/** Unprinted paper each side: what a roll printer's head can't reach (80mm prints 72, 58mm prints 48). */
const SIDE_MARGIN_MM = 5;
/** The printable width a ticket is designed at — an 80mm roll's, less the margins. */
const DESIGN_PRINTABLE_MM = 70;
/** Type no smaller than a 58mm printer's own font, and never larger than designed. */
const MIN_SCALE = 0.72;
const MAX_SCALE = 1;
/** A ticket is never wider than a 112mm roll's print, however wide the paper. */
const MAX_PRINTABLE_MM = 104;

const PX_PER_MM = 96 / 25.4;

export interface PaperLayout {
  /** The paper's width: the page width the printer is told. */
  pageMm: number;
  /** How wide the ticket prints, centred on the paper. */
  printableMm: number;
  /** How much the ticket is scaled; 1 is the size it is designed at. */
  zoom: number;
  /** The width the ticket is laid out at before scaling — what sets where lines wrap. */
  layoutPx: number;
}

/** Any number to a width this can print on: whole millimetres, within range. */
export function clampPaperWidth(mm: number): number {
  if (!Number.isFinite(mm)) return DEFAULT_PAPER_MM;
  return Math.min(PAPER_MAX_MM, Math.max(PAPER_MIN_MM, Math.round(mm)));
}

export function paperLayout(paperMm: number): PaperLayout {
  const pageMm = clampPaperWidth(paperMm);
  const printableMm = Math.min(pageMm - 2 * SIDE_MARGIN_MM, MAX_PRINTABLE_MM);
  const zoom = Math.min(MAX_SCALE, Math.max(MIN_SCALE, printableMm / DESIGN_PRINTABLE_MM));
  const layoutPx = Math.round(((printableMm * PX_PER_MM) / zoom) * 100) / 100;
  return { pageMm, printableMm, zoom: Math.round(zoom * 1000) / 1000, layoutPx };
}

const KEY: Record<PaperKind, string> = {
  receipt: "toffeeos.print.paper.receipt",
  kitchen: "toffeeos.print.paper.kitchen",
};
const listeners = new Set<() => void>();
/** This visit's choice, for when storage is blocked: not remembered, but still used until the page is left. */
const chosen: Partial<Record<PaperKind, number>> = {};

export function readPaperWidth(kind: PaperKind): number {
  try {
    const stored = window.localStorage.getItem(KEY[kind]);
    if (stored) return clampPaperWidth(Number(stored));
  } catch {
    /* blocked storage: fall through */
  }
  return chosen[kind] ?? DEFAULT_PAPER_MM;
}

export function setPaperWidth(kind: PaperKind, mm: number): void {
  chosen[kind] = clampPaperWidth(mm);
  try {
    window.localStorage.setItem(KEY[kind], String(chosen[kind]));
  } catch {
    /* not remembered on this device, but used for this visit */
  }
  listeners.forEach((l) => l());
}

/** This device's paper width for this kind of ticket. */
export function usePaperWidth(kind: PaperKind): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => readPaperWidth(kind),
    () => DEFAULT_PAPER_MM
  );
}
