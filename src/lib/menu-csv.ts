/**
 * Reading a menu out of a spreadsheet.
 *
 * Typing in a café's menu is the longest part of onboarding one — seventy-eight items with two cup
 * sizes each is an evening of clicking, and every minute of it is a chance to fat-finger a price.
 * Every restaurant already has the menu in a spreadsheet or can export one, so this reads that.
 *
 * The format is one row per *sellable line*, which is how a menu is actually written down:
 *
 *     Category,Item,Size,Price,Description
 *     Coffee,Latte,12oz,599,
 *     Coffee,Latte,16oz,699,
 *     Fries,Plain Fries,,549,Crispy and salted
 *
 * Rows sharing a category and item become one item with a size each; a blank size means the item
 * has one price. That covers both shapes without asking anyone to understand variants.
 *
 * Parsing and validating live here, separately from anything that writes to a database, because
 * this is where the subtle failures are — a quoted comma, a price with a stray space, two rows
 * claiming the same size — and they are much easier to pin down in a pure function.
 */

export interface ParsedVariant {
  name: string;
  pricePaisa: number;
  /** The 1-based line in the file this came from, so an error can point at it. */
  line: number;
}

export interface ParsedItem {
  category: string;
  name: string;
  description?: string;
  /** Empty when the item has a single price; otherwise one entry per size. */
  variants: ParsedVariant[];
  /** The single price, when there are no sizes. */
  pricePaisa: number;
  line: number;
}

export interface RowError {
  line: number;
  message: string;
}

export interface ParsedMenu {
  items: ParsedItem[];
  errors: RowError[];
  /** Distinct category names, in the order they first appear. */
  categories: string[];
}

const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;
/** Rs 100,000 a plate. Anything above this is a typo — a missing decimal, or paisa entered as rupees. */
const MAX_PRICE_RUPEES = 100_000;

/**
 * Splits CSV text into rows of fields, handling the three things spreadsheets actually do:
 * quoted fields containing commas, doubled quotes as an escape, and newlines inside quotes.
 *
 * Written out rather than pulled from a library because the library would be one more thing in the
 * bundle for forty lines of state machine, and because a parser this small is worth being able to
 * read when a café's export does something strange.
 */
export function parseCsvRows(text: string): string[][] {
  // Excel writes a byte-order mark. Left in place it becomes part of the first header name, and the
  // whole file then fails on "no Category column" with the column plainly visible in the file.
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  // Whatever is left when the text ends is the last field, unless the file ended on a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Rupees as typed -> paisa, or null if it is not a number we should accept. */
function priceToPaisa(raw: string): number | null {
  // Tolerate what people actually paste: "Rs 599", "599.00", "1,299", a stray space.
  const cleaned = raw.trim().replace(/^rs\.?\s*/i, "").replace(/,/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE_RUPEES) return null;
  // Round once, here. A price of 12.345 becoming 1234.5 paisa would be rejected by the pricing
  // engine's assertInt much further downstream, where the message would mean nothing to anyone.
  return Math.round(value * 100);
}

const HEADER_ALIASES: Record<string, string> = {
  category: "category",
  section: "category",
  group: "category",
  item: "item",
  name: "item",
  product: "item",
  "item name": "item",
  size: "size",
  variant: "size",
  option: "size",
  price: "price",
  amount: "price",
  rate: "price",
  description: "description",
  notes: "description",
  detail: "description",
};

/**
 * Turns CSV text into items, collecting every problem rather than stopping at the first.
 *
 * Reporting all the errors at once matters: someone fixing a menu export wants the whole list in
 * one pass, not to re-upload thirty times. Nothing here writes anything, so a file with errors can
 * be shown to the owner before a single row is committed.
 */
export function parseMenuCsv(text: string): ParsedMenu {
  const rows = parseCsvRows(text).filter((r) => r.some((f) => f.trim() !== ""));
  const errors: RowError[] = [];

  if (rows.length === 0) return { items: [], errors: [{ line: 1, message: "The file is empty." }], categories: [] };

  // Header, in any order and any of the usual spellings, so an export does not have to be reshaped
  // by hand before it can be used.
  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim().toLowerCase());
  const col = (key: string) => header.indexOf(key);
  const categoryAt = col("category");
  const itemAt = col("item");
  const priceAt = col("price");
  const sizeAt = col("size");
  const descriptionAt = col("description");

  const missing = [
    categoryAt === -1 ? "Category" : null,
    itemAt === -1 ? "Item" : null,
    priceAt === -1 ? "Price" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      items: [],
      errors: [{ line: 1, message: `The first row must name the columns. Missing: ${missing.join(", ")}.` }],
      categories: [],
    };
  }

  /** category::item -> the item being assembled, so sizes of one drink land on one item. */
  const byKey = new Map<string, ParsedItem>();
  const categories: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const cells = rows[i];
    const cell = (at: number) => (at >= 0 && at < cells.length ? cells[at].trim() : "");

    const category = cell(categoryAt);
    const name = cell(itemAt);
    const size = cell(sizeAt);
    const description = cell(descriptionAt);
    const pricePaisa = priceToPaisa(cell(priceAt));

    if (!category) {
      errors.push({ line, message: "No category." });
      continue;
    }
    if (!name) {
      errors.push({ line, message: "No item name." });
      continue;
    }
    if (name.length > MAX_NAME) {
      errors.push({ line, message: `Item name is longer than ${MAX_NAME} characters.` });
      continue;
    }
    if (description.length > MAX_DESCRIPTION) {
      errors.push({ line, message: `Description is longer than ${MAX_DESCRIPTION} characters.` });
      continue;
    }
    if (pricePaisa === null) {
      errors.push({ line, message: `"${cell(priceAt)}" is not a price.` });
      continue;
    }

    const key = `${category.toLowerCase()}::${name.toLowerCase()}`;
    const existing = byKey.get(key);

    if (!existing) {
      if (!categories.includes(category)) categories.push(category);
      byKey.set(key, {
        category,
        name,
        description: description || undefined,
        variants: size ? [{ name: size, pricePaisa, line }] : [],
        pricePaisa,
        line,
      });
      continue;
    }

    // A second row for an item it has already seen. Only sizes can do that legitimately.
    if (!size) {
      errors.push({ line, message: `"${name}" appears twice in ${category} with no size to tell them apart.` });
      continue;
    }
    if (existing.variants.length === 0) {
      errors.push({
        line,
        message: `"${name}" has a size here but no size on line ${existing.line}. Give every row a size, or none.`,
      });
      continue;
    }
    if (existing.variants.some((v) => v.name.toLowerCase() === size.toLowerCase())) {
      errors.push({ line, message: `"${name}" already has a size called "${size}".` });
      continue;
    }

    existing.variants.push({ name: size, pricePaisa, line });
    // The item's own price is the cheapest size, so the menu grid shows "from" the smallest — and
    // so the stored variant deltas come out positive, which is how a person reads a size list.
    if (pricePaisa < existing.pricePaisa) existing.pricePaisa = pricePaisa;
    if (!existing.description && description) existing.description = description;
  }

  return { items: [...byKey.values()], errors, categories };
}
