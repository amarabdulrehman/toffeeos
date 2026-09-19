import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";

/**
 * Sizes and add-ons — the two things a menu could always *have* but nobody could ever set up.
 *
 * ItemVariant and ModifierGroup have been in the schema since the beginning and are priced
 * correctly at the till, but they had no API and no screen: the only way to create one was to write
 * to the database by hand. So every tenant's menu was stuck at one size per item and no add-ons,
 * and a café menu with 12oz/16oz cups and a dips list simply could not be represented.
 *
 * The price model is worth understanding before touching this. A variant stores a *delta* from the
 * item's base price, not an absolute one, so raising the base price raises every size with it. That
 * is the right behaviour for a menu — put the price of coffee up and all cups follow — but it is
 * not how anyone thinks when typing a menu in. So this module takes absolute prices and converts,
 * and hands absolute prices back out; the delta never reaches the UI.
 */

const MAX_NAME = 80;

function normalise(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

async function requireMenuItem(tenantId: string, menuItemId: string) {
  const item = await tenantDb(tenantId).menuItem.findFirst({ where: { id: menuItemId } });
  if (!item) throw new HttpError(404, "That menu item doesn't exist.");
  return item;
}

/* ------------------------------------------------------------------ sizes */

export interface VariantView {
  id: string;
  name: string;
  /** Absolute price, not the stored delta — base price plus the delta. */
  pricePaisa: number;
  isDefault: boolean;
  sortOrder: number;
}

export async function listVariants(tenantId: string, menuItemId: string): Promise<VariantView[]> {
  const item = await requireMenuItem(tenantId, menuItemId);
  const variants = await tenantDb(tenantId).itemVariant.findMany({
    where: { menuItemId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return variants.map((v) => ({
    id: v.id,
    name: v.name,
    pricePaisa: item.basePricePaisa + v.priceDeltaPaisa,
    isDefault: v.isDefault,
    sortOrder: v.sortOrder,
  }));
}

export async function addVariant(
  tenantId: string,
  menuItemId: string,
  input: { name: string; pricePaisa: number }
): Promise<VariantView> {
  const db = tenantDb(tenantId);
  const item = await requireMenuItem(tenantId, menuItemId);
  const name = normalise(input.name);
  if (!name) throw new HttpError(400, "Give the size a name.");
  if (name.length > MAX_NAME) throw new HttpError(400, `Keep the name under ${MAX_NAME} characters.`);

  const existing = await db.itemVariant.findMany({ where: { menuItemId } });
  // Two sizes with the same name make the till's size picker unanswerable — the cashier is shown
  // two identical buttons and the receipt cannot tell them apart afterwards.
  if (existing.some((v) => v.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(400, `${item.name} already has a size called "${name}".`);
  }

  const created = await db.itemVariant.create({
    data: {
      tenantId,
      menuItemId,
      name,
      priceDeltaPaisa: input.pricePaisa - item.basePricePaisa,
      // The first size added becomes the default, so an item never ends up with sizes and no
      // pre-selected one.
      isDefault: existing.length === 0,
      sortOrder: existing.length,
    },
  });

  return {
    id: created.id,
    name: created.name,
    pricePaisa: item.basePricePaisa + created.priceDeltaPaisa,
    isDefault: created.isDefault,
    sortOrder: created.sortOrder,
  };
}

export async function updateVariant(
  tenantId: string,
  variantId: string,
  input: { name?: string; pricePaisa?: number; isDefault?: boolean }
): Promise<VariantView> {
  const db = tenantDb(tenantId);
  const variant = await db.itemVariant.findFirst({ where: { id: variantId } });
  if (!variant) throw new HttpError(404, "That size doesn't exist.");
  const item = await requireMenuItem(tenantId, variant.menuItemId);

  const data: { name?: string; priceDeltaPaisa?: number; isDefault?: boolean } = {};

  if (input.name !== undefined) {
    const name = normalise(input.name);
    if (!name) throw new HttpError(400, "Give the size a name.");
    if (name.length > MAX_NAME) throw new HttpError(400, `Keep the name under ${MAX_NAME} characters.`);
    const siblings = await db.itemVariant.findMany({ where: { menuItemId: variant.menuItemId } });
    if (siblings.some((v) => v.id !== variantId && v.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(400, `${item.name} already has a size called "${name}".`);
    }
    data.name = name;
  }

  if (input.pricePaisa !== undefined) {
    data.priceDeltaPaisa = input.pricePaisa - item.basePricePaisa;
  }

  if (input.isDefault) {
    // Exactly one default, or the till has to guess which size to pre-select.
    await db.itemVariant.updateMany({ where: { menuItemId: variant.menuItemId }, data: { isDefault: false } });
    data.isDefault = true;
  }

  const updated = await db.itemVariant.update({ where: { id: variantId }, data });
  return {
    id: updated.id,
    name: updated.name,
    pricePaisa: item.basePricePaisa + updated.priceDeltaPaisa,
    isDefault: updated.isDefault,
    sortOrder: updated.sortOrder,
  };
}

export async function removeVariant(tenantId: string, variantId: string): Promise<void> {
  const db = tenantDb(tenantId);
  const variant = await db.itemVariant.findFirst({ where: { id: variantId } });
  if (!variant) throw new HttpError(404, "That size doesn't exist.");

  await db.itemVariant.delete({ where: { id: variantId } });

  // Order history is unaffected: OrderLine.variantId is a plain column, not a foreign key, and the
  // line carries its own nameSnapshot and unitPricePaisa. A sold "Latte (16oz)" still reads that
  // way and still totals the same after the size is retired.

  if (variant.isDefault) {
    const remaining = await db.itemVariant.findMany({
      where: { menuItemId: variant.menuItemId },
      // Tie-broken, because the first row here becomes the new default size. An ambiguous order
      // would make which size that is depend on the query plan.
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    if (remaining.length > 0) {
      await db.itemVariant.update({ where: { id: remaining[0].id }, data: { isDefault: true } });
    }
  }
}

/* --------------------------------------------------------------- add-ons */

export interface ModifierGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: string; priceDeltaPaisa: number }[];
  /** How many menu items currently offer this group. */
  attachedCount: number;
}

export async function listModifierGroups(tenantId: string): Promise<ModifierGroupView[]> {
  const db = tenantDb(tenantId);
  const groups = await db.modifierGroup.findMany({
    include: {
      modifiers: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      _count: { select: { menuItems: true } },
    },
    orderBy: { name: "asc" },
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceDeltaPaisa: m.priceDeltaPaisa })),
    attachedCount: g._count.menuItems,
  }));
}

function assertSelectRange(minSelect: number, maxSelect: number) {
  if (maxSelect < 1) throw new HttpError(400, "A group has to allow at least one choice.");
  if (minSelect < 0) throw new HttpError(400, "The minimum cannot be negative.");
  if (minSelect > maxSelect) {
    throw new HttpError(400, `Asking for at least ${minSelect} but at most ${maxSelect} can never be satisfied.`);
  }
}

export async function createModifierGroup(
  tenantId: string,
  input: { name: string; minSelect: number; maxSelect: number }
) {
  const db = tenantDb(tenantId);
  const name = normalise(input.name);
  if (!name) throw new HttpError(400, "Give the group a name.");
  if (name.length > MAX_NAME) throw new HttpError(400, `Keep the name under ${MAX_NAME} characters.`);
  assertSelectRange(input.minSelect, input.maxSelect);

  const existing = await db.modifierGroup.findMany({});
  if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(400, `There is already a group called "${name}".`);
  }

  return db.modifierGroup.create({
    data: { tenantId, name, minSelect: input.minSelect, maxSelect: input.maxSelect },
  });
}

export async function updateModifierGroup(
  tenantId: string,
  groupId: string,
  input: { name?: string; minSelect?: number; maxSelect?: number }
) {
  const db = tenantDb(tenantId);
  const group = await db.modifierGroup.findFirst({ where: { id: groupId }, include: { modifiers: true } });
  if (!group) throw new HttpError(404, "That group doesn't exist.");

  const minSelect = input.minSelect ?? group.minSelect;
  const maxSelect = input.maxSelect ?? group.maxSelect;
  assertSelectRange(minSelect, maxSelect);

  const data: { name?: string; minSelect: number; maxSelect: number } = { minSelect, maxSelect };

  if (input.name !== undefined) {
    const name = normalise(input.name);
    if (!name) throw new HttpError(400, "Give the group a name.");
    const others = await db.modifierGroup.findMany({});
    if (others.some((g) => g.id !== groupId && g.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(400, `There is already a group called "${name}".`);
    }
    data.name = name;
  }

  return db.modifierGroup.update({ where: { id: groupId }, data });
}

export async function removeModifierGroup(tenantId: string, groupId: string): Promise<void> {
  const db = tenantDb(tenantId);
  const group = await db.modifierGroup.findFirst({ where: { id: groupId } });
  if (!group) throw new HttpError(404, "That group doesn't exist.");

  // Detach from every item and drop its options first — both reference the group, and leaving
  // either behind would strand rows that nothing can reach.
  await db.menuItemModifierGroup.deleteMany({ where: { groupId } });
  await db.modifier.deleteMany({ where: { groupId } });
  await db.modifierGroup.delete({ where: { id: groupId } });
}

export async function addModifier(
  tenantId: string,
  groupId: string,
  input: { name: string; priceDeltaPaisa: number }
) {
  const db = tenantDb(tenantId);
  const group = await db.modifierGroup.findFirst({ where: { id: groupId }, include: { modifiers: true } });
  if (!group) throw new HttpError(404, "That group doesn't exist.");

  const name = normalise(input.name);
  if (!name) throw new HttpError(400, "Give the option a name.");
  if (name.length > MAX_NAME) throw new HttpError(400, `Keep the name under ${MAX_NAME} characters.`);
  if (group.modifiers.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(400, `"${group.name}" already has an option called "${name}".`);
  }

  return db.modifier.create({
    data: {
      tenantId,
      groupId,
      name,
      priceDeltaPaisa: input.priceDeltaPaisa,
      sortOrder: group.modifiers.length,
    },
  });
}

export async function removeModifier(tenantId: string, modifierId: string): Promise<void> {
  const db = tenantDb(tenantId);
  const modifier = await db.modifier.findFirst({ where: { id: modifierId }, include: { group: true } });
  if (!modifier) throw new HttpError(404, "That option doesn't exist.");

  // Removing the option would leave the group unable to meet its own minimum, which makes every
  // item offering it unorderable. Say so here rather than let the till start refusing orders.
  const siblings = await db.modifier.count({ where: { groupId: modifier.groupId } });
  if (siblings - 1 < modifier.group.minSelect) {
    throw new HttpError(
      400,
      `"${modifier.group.name}" requires at least ${modifier.group.minSelect} choice(s), so it cannot drop to ` +
        `${siblings - 1} option(s). Lower the minimum first.`
    );
  }

  await db.modifier.delete({ where: { id: modifierId } });
}

/* ------------------------------------------- which groups an item offers */

export async function listItemModifierGroupIds(tenantId: string, menuItemId: string): Promise<string[]> {
  await requireMenuItem(tenantId, menuItemId);
  const rows = await tenantDb(tenantId).menuItemModifierGroup.findMany({ where: { menuItemId } });
  return rows.map((r) => r.groupId);
}

/**
 * Sets the full list of groups an item offers, rather than exposing attach and detach separately —
 * the screen shows a checklist, and sending the resulting list is both what the UI naturally has
 * and idempotent if it is sent twice.
 */
export async function setItemModifierGroups(
  tenantId: string,
  menuItemId: string,
  groupIds: string[]
): Promise<string[]> {
  const db = tenantDb(tenantId);
  await requireMenuItem(tenantId, menuItemId);

  const wanted = [...new Set(groupIds)];
  if (wanted.length > 0) {
    const found = await db.modifierGroup.findMany({ where: { id: { in: wanted } } });
    if (found.length !== wanted.length) throw new HttpError(400, "One of those add-on groups doesn't exist.");

    // A group that cannot meet its own minimum makes the item unorderable the moment it is
    // attached, so refuse at the point the owner chooses it.
    for (const group of found) {
      const count = await db.modifier.count({ where: { groupId: group.id } });
      if (count < group.minSelect) {
        throw new HttpError(
          400,
          `"${group.name}" requires ${group.minSelect} choice(s) but only has ${count}. Add options to it first.`
        );
      }
    }
  }

  const current = await db.menuItemModifierGroup.findMany({ where: { menuItemId } });
  const currentIds = new Set(current.map((r) => r.groupId));

  const toAdd = wanted.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !wanted.includes(id));

  if (toRemove.length > 0) {
    await db.menuItemModifierGroup.deleteMany({ where: { menuItemId, groupId: { in: toRemove } } });
  }
  for (const groupId of toAdd) {
    await db.menuItemModifierGroup.create({ data: { tenantId, menuItemId, groupId } });
  }

  return wanted;
}
