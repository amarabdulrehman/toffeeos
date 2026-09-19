import { describe, expect, it } from "vitest";
import { parseCsvRows, parseMenuCsv } from "@/lib/menu-csv";

/**
 * Menu import parsing.
 *
 * Worth testing hard rather than eyeballing, because every failure here is silent and lands in
 * money: a quoted comma that splits a field puts a price in the wrong column, a doubled quote that
 * is not unescaped corrupts an item name, and a size row that is not merged creates two items where
 * the café has one drink. None of that throws — it just produces a menu that is subtly wrong, which
 * somebody then sells from.
 *
 * The parser is pure, so all of it can be pinned here rather than through a database.
 */

describe("parseCsvRows", () => {
  it("reads plain rows", () => {
    expect(parseCsvRows("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a quoted comma inside its field", () => {
    // Without this, "Fries, large" becomes two fields and every column after it shifts left —
    // which lands the description where the price should be.
    expect(parseCsvRows('Snacks,"Fries, large",599')).toEqual([["Snacks", "Fries, large", "599"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvRows('a,"He said ""hi""",1')).toEqual([["a", 'He said "hi"', "1"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsvRows('a,"line one\nline two"')).toEqual([["a", "line one\nline two"]]);
  });

  it("handles CRLF, which is what Excel writes on Windows", () => {
    expect(parseCsvRows("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the byte-order mark Excel puts at the start", () => {
    // Left in, it becomes part of the first header name, and the file fails on "no Category column"
    // while the column is plainly visible to whoever is reading the spreadsheet.
    const [header] = parseCsvRows("﻿Category,Item");
    expect(header[0]).toBe("Category");
  });

  it("does not invent a trailing empty row", () => {
    expect(parseCsvRows("a,b\n1,2\n")).toHaveLength(2);
  });

  it("keeps empty fields rather than dropping them", () => {
    expect(parseCsvRows("a,,c")).toEqual([["a", "", "c"]]);
  });
});

describe("parseMenuCsv", () => {
  const header = "Category,Item,Size,Price,Description";

  it("reads a single-price item", () => {
    const { items, errors } = parseMenuCsv(`${header}\nFries,Plain Fries,,549,Crispy`);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: "Fries",
      name: "Plain Fries",
      pricePaisa: 54_900,
      description: "Crispy",
    });
    expect(items[0].variants).toHaveLength(0);
  });

  it("merges rows that differ only by size into one item", () => {
    // The whole reason the format is one row per sellable line: a café writes two cup sizes as two
    // lines, and means one drink.
    const { items, errors } = parseMenuCsv(`${header}\nCoffee,Latte,12oz,599,\nCoffee,Latte,16oz,699,`);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].variants.map((v) => [v.name, v.pricePaisa])).toEqual([
      ["12oz", 59_900],
      ["16oz", 69_900],
    ]);
  });

  it("prices a sized item at its cheapest size", () => {
    // So the menu grid reads as the smallest cup, and every stored size delta comes out positive.
    const { items } = parseMenuCsv(`${header}\nCoffee,Latte,16oz,699,\nCoffee,Latte,12oz,599,`);
    expect(items[0].pricePaisa).toBe(59_900);
  });

  it("treats the same name in two categories as two items", () => {
    // "Vanilla" is a coffee, a frappe and a matcha on a real café board.
    const { items, errors } = parseMenuCsv(`${header}\nCoffee,Vanilla,,649,\nFrappe,Vanilla,,999,`);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(2);
  });

  it("accepts the price formats people actually paste", () => {
    // The thousands separator has to be quoted, because in CSV an unquoted comma is a field
    // separator and nothing else — `1,299` really is two fields, and a parser that guessed
    // otherwise would mis-split every row containing a comma. Excel quotes it, which is why this
    // is the realistic form.
    const { items, errors } = parseMenuCsv(
      `${header}
A,One,,Rs 549,
A,Two,,"1,299",
A,Three,,599.50,`
    );
    expect(errors).toEqual([]);
    expect(items.map((i) => i.pricePaisa)).toEqual([54_900, 129_900, 59_950]);
  });

  it("treats an unquoted thousands separator as the field separator it is", () => {
    // Stated explicitly so the behaviour is a decision rather than an accident: the row has one
    // column too many, the price column holds "1", and nothing silently becomes Rs 1,299.
    const { items } = parseMenuCsv(`${header}
A,Two,,1,299`);
    expect(items[0].pricePaisa).toBe(100);
  });

  it("accepts any column order and the usual spellings", () => {
    const { items, errors } = parseMenuCsv("Name,Amount,Section\nLatte,599,Coffee");
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ category: "Coffee", name: "Latte", pricePaisa: 59_900 });
  });

  it("refuses a file with no header", () => {
    const { errors, items } = parseMenuCsv("Fries,Plain Fries,549");
    expect(items).toEqual([]);
    expect(errors[0].message).toMatch(/must name the columns/i);
  });

  it("reports every bad row rather than stopping at the first", () => {
    // Someone fixing an export wants the whole list in one pass, not thirty re-uploads.
    const { errors } = parseMenuCsv(
      `${header}\n,Nameless,,100,\nFries,,,100,\nFries,Bad Price,,abc,\nFries,Negative,,-5,`
    );
    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });

  it("points at the line number in the file, not the row index", () => {
    const { errors } = parseMenuCsv(`${header}\nFries,Good,,100,\nFries,Bad,,nope,`);
    expect(errors[0].line, "the third line of the file").toBe(3);
  });

  it("catches the same item listed twice with no size", () => {
    const { errors } = parseMenuCsv(`${header}\nFries,Plain,,549,\nFries,Plain,,599,`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/appears twice/i);
  });

  it("catches an item that is sized on one row and not on another", () => {
    // Half-sized items are the ambiguous case: the till cannot show a size picker with one real
    // option and one nameless one.
    const { errors } = parseMenuCsv(`${header}\nCoffee,Latte,,599,\nCoffee,Latte,16oz,699,`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no size on line 2/i);
  });

  it("catches a repeated size on one item", () => {
    const { errors } = parseMenuCsv(`${header}\nCoffee,Latte,12oz,599,\nCoffee,Latte,12oz,649,`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/already has a size/i);
  });

  it("rejects a price high enough to be a typo", () => {
    // Paisa pasted into a rupees column is the realistic version of this: 59900 becomes Rs 59,900.
    const { errors } = parseMenuCsv(`${header}\nA,Gold Plated,,9999999,`);
    expect(errors).toHaveLength(1);
  });

  it("ignores blank lines", () => {
    const { items, errors } = parseMenuCsv(`${header}\n\nFries,Plain,,549,\n\n`);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
  });

  it("lists categories once, in the order they appear", () => {
    const { categories } = parseMenuCsv(
      `${header}\nCoffee,A,,1,\nFries,B,,1,\nCoffee,C,,1,`
    );
    expect(categories).toEqual(["Coffee", "Fries"]);
  });

  it("survives a quoted comma in an item name without shifting the price", () => {
    // The end-to-end version of the parser test above, because this is the failure that would put
    // a description where a price belongs and go unnoticed.
    const { items, errors } = parseMenuCsv(`${header}\nSnacks,"Fries, large",,849,Sharing size`);
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ name: "Fries, large", pricePaisa: 84_900, description: "Sharing size" });
  });
});
