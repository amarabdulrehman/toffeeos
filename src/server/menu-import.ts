import "server-only";
import { tenantDb } from "@/server/db";
import { addVariant } from "@/server/menu-options";
import { parseMenuCsv, type ParsedMenu } from "@/lib/menu-csv";

/**
 * Turning a parsed spreadsheet into a menu.
 *
 * Deliberately two steps: a caller can ask what *would* happen and show it to the owner before a
 * single row is written. Importing seventy-eight items is exactly the operation nobody wants to
 * discover was wrong afterwards, and "preview, then commit" costs one extra request.
 *
 * Not wrapped in one transaction, which is a considered choice rather than an omission. Seventy-odd
 * items is well past an interactive transaction's timeout, and the alternative — all-or-nothing
 * across a long write — is worse here than the property this has instead: the import skips anything
 * already on the menu, so a run that dies halfway is fixed by running it again. Partial progress
 * that can be resumed beats a rollback that loses twenty minutes of somebody's evening.
 */

export interface ImportSummary {
  /** Categories that did not exist and were created. */
  categoriesCreated: string[];
  itemsCreated: number;
  variantsCreated: number;
  /** Items already on the menu, left exactly as they were. */
  skipped: { category: string; name: string }[];
  errors: { line: number; message: string }[];
}

export interface ImportPreview extends ImportSummary {
  /** True when nothing was written — either a dry run, or errors stopped it. */
  previewOnly: boolean;
  /** Everything the file describes, for the owner to look over. */
  items: { category: string; name: string; pricePaisa: number; sizes: string[]; exists: boolean }[];
}

/**
 * Reads the file and works out what it would do, touching nothing.
 *
 * `exists` is resolved against the live menu rather than guessed, because "this will add 78 items"
 * and "this will add 4 items and leave 74 alone" are very different things to agree to.
 */
export async function previewMenuImport(tenantId: string, csv: string): Promise<ImportPreview> {
  const parsed = parseMenuCsv(csv);
  const { existingCategories, existingItemKeys } = await loadExisting(tenantId);

  const items = parsed.items.map((item) => ({
    category: item.category,
    name: item.name,
    pricePaisa: item.pricePaisa,
    sizes: item.variants.map((v) => v.name),
    exists: existingItemKeys.has(itemKey(item.category, item.name)),
  }));

  return {
    previewOnly: true,
    items,
    categoriesCreated: parsed.categories.filter((c) => !existingCategories.has(c.toLowerCase())),
    itemsCreated: items.filter((i) => !i.exists).length,
    variantsCreated: parsed.items
      .filter((i) => !existingItemKeys.has(itemKey(i.category, i.name)))
      .reduce((sum, i) => sum + i.variants.length, 0),
    skipped: items.filter((i) => i.exists).map((i) => ({ category: i.category, name: i.name })),
    errors: parsed.errors,
  };
}

/**
 * Writes the menu.
 *
 * Refuses outright if the file has any bad rows. A partial import from a file the owner has not
 * corrected is the worst outcome available: they fix the spreadsheet, re-run, and now have to work
 * out which half went in the first time.
 */
export async function applyMenuImport(tenantId: string, csv: string): Promise<ImportSummary> {
  const parsed = parseMenuCsv(csv);
  if (parsed.errors.length > 0) {
    return {
      categoriesCreated: [],
      itemsCreated: 0,
      variantsCreated: 0,
      skipped: [],
      errors: parsed.errors,
    };
  }

  const db = tenantDb(tenantId);
  const { categoryIdByName, existingItemKeys } = await loadExisting(tenantId);

  const summary: ImportSummary = {
    categoriesCreated: [],
    itemsCreated: 0,
    variantsCreated: 0,
    skipped: [],
    errors: [],
  };

  let sortOrder = categoryIdByName.size;

  for (const item of parsed.items) {
    let categoryId = categoryIdByName.get(item.category.toLowerCase());
    if (!categoryId) {
      const created = await db.category.create({
        data: { tenantId, name: item.category, sortOrder: sortOrder++ },
      });
      categoryId = created.id;
      categoryIdByName.set(item.category.toLowerCase(), categoryId);
      summary.categoriesCreated.push(item.category);
    }

    if (existingItemKeys.has(itemKey(item.category, item.name))) {
      summary.skipped.push({ category: item.category, name: item.name });
      continue;
    }

    const menuItem = await db.menuItem.create({
      data: {
        tenantId,
        categoryId,
        name: item.name,
        basePricePaisa: item.pricePaisa,
        description: item.description,
      },
    });
    summary.itemsCreated++;

    // Through addVariant rather than a direct create, so an imported size is identical to one typed
    // in by hand: same absolute-price-to-delta conversion, same duplicate-name check, same
    // first-size-becomes-default rule. Two ways to make a variant that differ in any of those is a
    // bug waiting for whichever path is less used.
    for (const variant of item.variants) {
      await addVariant(tenantId, menuItem.id, { name: variant.name, pricePaisa: variant.pricePaisa });
      summary.variantsCreated++;
    }
  }

  return summary;
}

function itemKey(category: string, name: string): string {
  return `${category.toLowerCase()}::${name.toLowerCase()}`;
}

async function loadExisting(tenantId: string) {
  const db = tenantDb(tenantId);
  const categories = await db.category.findMany({ include: { items: { select: { name: true } } } });

  return {
    categoryIdByName: new Map(categories.map((c) => [c.name.toLowerCase(), c.id])),
    existingCategories: new Set(categories.map((c) => c.name.toLowerCase())),
    existingItemKeys: new Set(categories.flatMap((c) => c.items.map((i) => itemKey(c.name, i.name)))),
  };
}

export type { ParsedMenu };
