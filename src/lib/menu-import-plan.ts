import { formatPkr } from "@/lib/money";
import type { ParsedItem } from "@/lib/menu-csv";

/**
 * What re-importing a spreadsheet does to an item that is already on the menu.
 *
 * The first version skipped existing items outright, so a price list updated in the spreadsheet —
 * the one thing a café does every few months — could not be brought in; every price had to be
 * changed by hand. Now the file wins where it says something different, with three limits:
 *
 * - Nothing is ever deleted. A size or item missing from the file is left as it is: a spreadsheet
 *   that happens to omit the breakfast menu must not take it off the till.
 * - An item with sizes on the menu but a single price in the file is left alone and the owner is
 *   told why. Whether that means "drop the sizes" or "the file is incomplete" is not ours to guess.
 * - A blank description in the file leaves the menu's description alone — blank means "not given".
 *
 * Kept pure — no database — so every rule is unit-tested directly.
 */

export interface ExistingItem {
  id: string;
  basePricePaisa: number;
  description: string | null;
  variants: { id: string; name: string; priceDeltaPaisa: number }[];
}

export type ItemPlan =
  | { kind: "same" }
  | { kind: "leftAlone"; reason: string }
  | {
      kind: "update";
      /** In plain words, for the preview: "price Rs 480 → Rs 520". */
      changes: string[];
      basePricePaisa: number;
      description?: string;
      /** Every existing size's new absolute price, so none drifts when the base price moves. */
      variantPrices: { id: string; pricePaisa: number }[];
      newVariants: { name: string; pricePaisa: number }[];
    };

export function planItemUpdate(existing: ExistingItem, file: ParsedItem): ItemPlan {
  const changes: string[] = [];

  const description = file.description !== undefined && file.description !== (existing.description ?? "")
    ? file.description
    : undefined;
  if (description !== undefined) changes.push("description");

  const absolute = (v: { priceDeltaPaisa: number }) => existing.basePricePaisa + v.priceDeltaPaisa;

  if (file.variants.length === 0) {
    if (existing.variants.length > 0) {
      return {
        kind: "leftAlone",
        reason: `has sizes on the menu (${existing.variants.map((v) => v.name).join(", ")}) but one price in the file`,
      };
    }
    if (file.pricePaisa !== existing.basePricePaisa) {
      changes.push(`price ${formatPkr(existing.basePricePaisa)} → ${formatPkr(file.pricePaisa)}`);
    }
    if (changes.length === 0) return { kind: "same" };
    return { kind: "update", changes, basePricePaisa: file.pricePaisa, description, variantPrices: [], newVariants: [] };
  }

  // The file has sizes. Every existing size keeps its absolute price unless the file names a new one;
  // the base moves to the file's cheapest size, and the deltas are worked out again from there.
  const byName = new Map(existing.variants.map((v) => [v.name.toLowerCase(), v]));
  const variantPrices = existing.variants.map((v) => ({ id: v.id, pricePaisa: absolute(v) }));
  const newVariants: { name: string; pricePaisa: number }[] = [];

  if (existing.variants.length === 0) {
    changes.push(`sizes added: ${file.variants.map((v) => v.name).join(", ")}`);
  }
  for (const fv of file.variants) {
    const match = byName.get(fv.name.toLowerCase());
    if (!match) {
      newVariants.push({ name: fv.name, pricePaisa: fv.pricePaisa });
      if (existing.variants.length > 0) changes.push(`new size ${fv.name} ${formatPkr(fv.pricePaisa)}`);
      continue;
    }
    const was = absolute(match);
    if (was !== fv.pricePaisa) {
      changes.push(`${match.name} ${formatPkr(was)} → ${formatPkr(fv.pricePaisa)}`);
      variantPrices.find((p) => p.id === match.id)!.pricePaisa = fv.pricePaisa;
    }
  }

  if (changes.length === 0 && file.pricePaisa === existing.basePricePaisa) return { kind: "same" };
  if (changes.length === 0) changes.push(`starting price ${formatPkr(existing.basePricePaisa)} → ${formatPkr(file.pricePaisa)}`);
  return { kind: "update", changes, basePricePaisa: file.pricePaisa, description, variantPrices, newVariants };
}
