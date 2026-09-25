import "server-only";
import { tenantDb } from "@/server/db";
import { addVariant, updateVariant } from "@/server/menu-options";
import { parseMenuCsv, type ParsedItem, type ParsedMenu } from "@/lib/menu-csv";
import { planItemUpdate, type ExistingItem, type ItemPlan } from "@/lib/menu-import-plan";

/**
 * Turning a parsed spreadsheet into a menu.
 *
 * Deliberately two steps: a caller can ask what *would* happen and show it to the owner before a
 * single row is written. Importing seventy-eight items is exactly the operation nobody wants to
 * discover was wrong afterwards, and "preview, then commit" costs one extra request.
 *
 * Items already on the menu are updated where the file says something different — a price, a size's
 * price, a new size, a description — and never deleted (see src/lib/menu-import-plan.ts). Running the
 * same file twice changes nothing the second time.
 *
 * Not wrapped in one transaction, which is a considered choice rather than an omission. Seventy-odd
 * items is well past an interactive transaction's timeout, and the alternative — all-or-nothing
 * across a long write — is worse here than the property this has instead: every step brings an item
 * to what the file says, so a run that dies halfway is finished by running it again. Partial
 * progress that can be resumed beats a rollback that loses twenty minutes of somebody's evening.
 */

export interface ImportSummary {
  /** Categories that did not exist and were created. */
  categoriesCreated: string[];
  itemsCreated: number;
  variantsCreated: number;
  /** Items already on the menu whose price, sizes or description the file changed. */
  itemsUpdated: { category: string; name: string; changes: string[] }[];
  /** Items already on the menu exactly as the file describes them. */
  skipped: { category: string; name: string }[];
  /** Items the file describes in a way that can't be applied safely, left exactly as they were. */
  leftAlone: { category: string; name: string; reason: string }[];
  errors: { line: number; message: string }[];
}

export interface ImportPreview extends ImportSummary {
  /** True when nothing was written — either a dry run, or errors stopped it. */
  previewOnly: boolean;
  /** Everything the file describes, for the owner to look over. */
  items: {
    category: string;
    name: string;
    pricePaisa: number;
    sizes: string[];
    exists: boolean;
    status: "new" | "update" | "same" | "leftAlone";
    /** What an update changes, or why an item is left alone. */
    notes: string[];
  }[];
}

/**
 * Reads the file and works out what it would do, touching nothing.
 *
 * Resolved against the live menu rather than guessed, because "this will add 78 items" and "this
 * will add 4 items and change 6 prices" are very different things to agree to.
 */
export async function previewMenuImport(tenantId: string, csv: string): Promise<ImportPreview> {
  const parsed = parseMenuCsv(csv);
  const { existingCategories, existingItems } = await loadExisting(tenantId);

  const summary = emptySummary();
  summary.errors = parsed.errors;
  summary.categoriesCreated = parsed.categories.filter((c) => !existingCategories.has(c.toLowerCase()));

  const items: ImportPreview["items"] = parsed.items.map((item) => {
    const base = { category: item.category, name: item.name, pricePaisa: item.pricePaisa, sizes: item.variants.map((v) => v.name) };
    const existing = existingItems.get(itemKey(item.category, item.name));
    if (!existing) {
      summary.itemsCreated++;
      summary.variantsCreated += item.variants.length;
      return { ...base, exists: false, status: "new" as const, notes: [] };
    }
    const plan = planItemUpdate(existing, item);
    return { ...base, exists: true, ...record(summary, item, plan) };
  });

  return { previewOnly: true, items, ...summary };
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
  const summary = emptySummary();
  if (parsed.errors.length > 0) {
    summary.errors = parsed.errors;
    return summary;
  }

  const db = tenantDb(tenantId);
  const { categoryIdByName, existingItems } = await loadExisting(tenantId);
  let sortOrder = categoryIdByName.size;

  for (const item of parsed.items) {
    const existing = existingItems.get(itemKey(item.category, item.name));
    if (existing) {
      const plan = planItemUpdate(existing, item);
      record(summary, item, plan);
      if (plan.kind === "update") await applyUpdate(tenantId, existing.id, plan);
      continue;
    }

    let categoryId = categoryIdByName.get(item.category.toLowerCase());
    if (!categoryId) {
      const created = await db.category.create({
        data: { tenantId, name: item.category, sortOrder: sortOrder++ },
      });
      categoryId = created.id;
      categoryIdByName.set(item.category.toLowerCase(), categoryId);
      summary.categoriesCreated.push(item.category);
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

/**
 * The base price first, then every size against it. The sizes are priced through updateVariant and
 * addVariant — the Menu screen's own paths — so a size changed by import is stored exactly as one
 * changed by hand.
 */
async function applyUpdate(tenantId: string, itemId: string, plan: Extract<ItemPlan, { kind: "update" }>) {
  await tenantDb(tenantId).menuItem.update({
    where: { id: itemId },
    data: {
      basePricePaisa: plan.basePricePaisa,
      ...(plan.description !== undefined ? { description: plan.description } : {}),
    },
  });
  for (const v of plan.variantPrices) await updateVariant(tenantId, v.id, { pricePaisa: v.pricePaisa });
  for (const v of plan.newVariants) await addVariant(tenantId, itemId, v);
}

function emptySummary(): ImportSummary {
  return { categoriesCreated: [], itemsCreated: 0, variantsCreated: 0, itemsUpdated: [], skipped: [], leftAlone: [], errors: [] };
}

/** Files one item's plan into the summary, and returns how the preview should show it. */
function record(
  summary: ImportSummary,
  item: ParsedItem,
  plan: ItemPlan
): { status: "update" | "same" | "leftAlone"; notes: string[] } {
  const who = { category: item.category, name: item.name };
  if (plan.kind === "same") {
    summary.skipped.push(who);
    return { status: "same", notes: [] };
  }
  if (plan.kind === "leftAlone") {
    summary.leftAlone.push({ ...who, reason: plan.reason });
    return { status: "leftAlone", notes: [plan.reason] };
  }
  summary.itemsUpdated.push({ ...who, changes: plan.changes });
  summary.variantsCreated += plan.newVariants.length;
  return { status: "update", notes: plan.changes };
}

function itemKey(category: string, name: string): string {
  return `${category.toLowerCase()}::${name.toLowerCase()}`;
}

async function loadExisting(tenantId: string) {
  const db = tenantDb(tenantId);
  const categories = await db.category.findMany({
    include: {
      items: {
        select: {
          id: true,
          name: true,
          basePricePaisa: true,
          description: true,
          variants: { select: { id: true, name: true, priceDeltaPaisa: true }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  const existingItems = new Map<string, ExistingItem>();
  for (const c of categories) for (const i of c.items) existingItems.set(itemKey(c.name, i.name), i);

  return {
    categoryIdByName: new Map(categories.map((c) => [c.name.toLowerCase(), c.id])),
    existingCategories: new Set(categories.map((c) => c.name.toLowerCase())),
    existingItems,
  };
}

export type { ParsedMenu };
