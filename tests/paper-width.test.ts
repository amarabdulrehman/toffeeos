import { describe, expect, it } from "vitest";
import { clampPaperWidth, paperLayout, PAPER_MAX_MM, PAPER_MIN_MM } from "@/lib/paper-width";

const PX_PER_MM = 96 / 25.4;
/** A monospace character is about 0.6em wide; the receipt's type is 13px before scaling. */
const charsPerLine = (layoutPx: number) => Math.floor(layoutPx / (0.6 * 13));

describe("fitting a ticket to the paper", () => {
  it("fits every whole-millimetre width from the narrowest roll to A4", () => {
    for (let mm = PAPER_MIN_MM; mm <= PAPER_MAX_MM; mm++) {
      const p = paperLayout(mm);
      expect(p.pageMm, `${mm}mm`).toBe(mm);
      // Inside the printable area: a margin a roll printer's head can't reach, each side.
      expect(p.printableMm, `${mm}mm`).toBeLessThanOrEqual(mm - 10);
      // What prints is exactly the printable width — laid out, then scaled.
      expect(Math.abs((p.layoutPx * p.zoom) / PX_PER_MM - p.printableMm), `${mm}mm`).toBeLessThan(0.1);
      // Never type too small to read, never larger than designed (it would only use more paper).
      expect(p.zoom, `${mm}mm`).toBeGreaterThanOrEqual(0.72);
      expect(p.zoom, `${mm}mm`).toBeLessThanOrEqual(1);
    }
  });

  it("prints an 80mm ticket at the size it was designed at", () => {
    const p = paperLayout(80);
    expect(p.zoom).toBe(1);
    expect(p.printableMm).toBe(70);
  });

  it("gives a 58mm roll the 32 characters a line its own printers print", () => {
    const p = paperLayout(58);
    expect(p.printableMm).toBe(48);
    expect(charsPerLine(p.layoutPx)).toBeGreaterThanOrEqual(32);
  });

  it("wraps lines on very narrow paper rather than shrinking the type further", () => {
    const narrow = paperLayout(44);
    expect(narrow.zoom).toBe(0.72);
    expect(charsPerLine(narrow.layoutPx)).toBeLessThan(charsPerLine(paperLayout(58).layoutPx));
  });

  it("gives wider paper more on each line, and doesn't stretch a receipt across a whole A4 sheet", () => {
    const wide = paperLayout(112);
    expect(wide.printableMm).toBe(102);
    expect(wide.zoom).toBe(1);
    expect(charsPerLine(wide.layoutPx)).toBeGreaterThan(charsPerLine(paperLayout(80).layoutPx) + 10);
    expect(paperLayout(210).printableMm).toBe(104);
  });

  it("turns anything typed into a width it can print on", () => {
    expect(clampPaperWidth(57.6)).toBe(58);
    expect(clampPaperWidth(10)).toBe(PAPER_MIN_MM);
    expect(clampPaperWidth(900)).toBe(PAPER_MAX_MM);
    expect(clampPaperWidth(Number("abc"))).toBe(80);
  });
});
