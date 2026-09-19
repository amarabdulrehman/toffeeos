import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Importing a menu from a spreadsheet.
 *
 * Onboarding a café meant typing its whole menu in by hand — seventy-eight items with two cup sizes
 * each is an evening of clicking and a fresh chance to fat-finger every price. This is the path that
 * replaces that, so what matters is not that rows go in but that the wrong ones do not: a file with
 * a bad row writes nothing at all, an item already on the menu is left alone rather than duplicated,
 * and a preview never touches anything.
 *
 * Parsing itself is pinned in tests/menu-csv.test.ts, where it is a pure function. This covers what
 * only a real tenant can show.
 */

const HEADER = "Category,Item,Size,Price,Description";

async function importCsv(ctx: APIRequestContext, csv: string, dryRun = false) {
  const res = await ctx.post("/api/menu/import", { data: { csv, dryRun } });
  return { res, body: await res.json().catch(() => ({})) };
}

async function menuHas(ctx: APIRequestContext, category: string, name: string): Promise<boolean> {
  const menu = await (await ctx.get("/api/menu")).json();
  return (menu.categories as { name: string; items: { name: string }[] }[])
    .filter((c) => c.name === category)
    .some((c) => c.items.some((i) => i.name === name));
}

test.describe("Menu import", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("a preview reports what would happen and writes nothing", async ({ request }) => {
    const category = `Import Preview ${uniqueSuffix()}`;
    const { res, body } = await importCsv(request, `${HEADER}\n${category},Ghost Item,,549,`, true);

    expect(res.ok(), await res.text()).toBeTruthy();
    expect(body.summary.itemsCreated, "the preview should say it would add one").toBe(1);
    expect(body.summary.categoriesCreated).toContain(category);

    expect(await menuHas(request, category, "Ghost Item"), "but nothing should exist yet").toBe(false);
  });

  test("a clean file creates the categories, items and sizes it describes", async ({ request }) => {
    const category = `Import ${uniqueSuffix()}`;
    const csv = [
      HEADER,
      `${category},Flat Item,,549,A plain one`,
      `${category},Sized Item,Small,599,`,
      `${category},Sized Item,Large,749,`,
    ].join("\n");

    const { res, body } = await importCsv(request, csv);
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(body.summary.errors).toEqual([]);
    expect(body.summary.itemsCreated).toBe(2);
    expect(body.summary.variantsCreated).toBe(2);

    const menu = await (await request.get("/api/menu")).json();
    const cat = (menu.categories as { name: string; items: { id: string; name: string; basePricePaisa: number }[] }[])
      .find((c) => c.name === category);
    expect(cat, "the category should have been created").toBeTruthy();

    const flat = cat!.items.find((i) => i.name === "Flat Item");
    expect(flat!.basePricePaisa, "rupees in the file become paisa in the menu").toBe(54_900);

    // The sized item takes the cheapest size as its base, so the size deltas are positive.
    const sized = cat!.items.find((i) => i.name === "Sized Item");
    expect(sized!.basePricePaisa).toBe(59_900);

    const variants = (await (await request.get(`/api/menu-items/${sized!.id}/variants`)).json()).variants;
    expect(variants.map((v: { name: string; pricePaisa: number }) => [v.name, v.pricePaisa])).toEqual([
      ["Small", 59_900],
      ["Large", 74_900],
    ]);
    // Same rule as adding a size by hand: the first one becomes the default.
    expect(variants[0].isDefault).toBe(true);
  });

  test("one bad row stops the whole file", async ({ request }) => {
    // The property that matters most. A partial import from a file the owner has not corrected is
    // the worst outcome available: they fix the spreadsheet, re-run, and now have to work out which
    // half went in the first time.
    const category = `Import Reject ${uniqueSuffix()}`;
    const csv = [HEADER, `${category},Good One,,549,`, `${category},Bad One,,not-a-price,`].join("\n");

    const { res, body } = await importCsv(request, csv);
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(body.summary.errors.length).toBeGreaterThan(0);
    expect(body.summary.itemsCreated).toBe(0);

    expect(await menuHas(request, category, "Good One"), "the valid row must not sneak in").toBe(false);
  });

  test("importing the same file twice adds nothing the second time", async ({ request }) => {
    // Re-running is how a half-finished import is completed, so it has to be safe. Duplicated menu
    // items are worse than a failed import: they are sellable, and the cashier cannot tell them
    // apart on the grid.
    const category = `Import Twice ${uniqueSuffix()}`;
    const csv = `${HEADER}\n${category},Only Once,,549,`;

    const first = await importCsv(request, csv);
    expect(first.body.summary.itemsCreated).toBe(1);

    const second = await importCsv(request, csv);
    expect(second.res.ok(), await second.res.text()).toBeTruthy();
    expect(second.body.summary.itemsCreated, "nothing new the second time").toBe(0);
    expect(second.body.summary.skipped).toHaveLength(1);

    const menu = await (await request.get("/api/menu")).json();
    const items = (menu.categories as { name: string; items: { name: string }[] }[])
      .filter((c) => c.name === category)
      .flatMap((c) => c.items)
      .filter((i) => i.name === "Only Once");
    expect(items, "exactly one, not two").toHaveLength(1);
  });

  test("items go into an existing category rather than a second one with the same name", async ({ request }) => {
    const category = `Import Existing ${uniqueSuffix()}`;
    await importCsv(request, `${HEADER}\n${category},First,,549,`);

    const { body } = await importCsv(request, `${HEADER}\n${category},Second,,649,`);
    expect(body.summary.categoriesCreated, "the category already existed").toEqual([]);
    expect(body.summary.itemsCreated).toBe(1);

    const menu = await (await request.get("/api/menu")).json();
    const matching = (menu.categories as { name: string }[]).filter((c) => c.name === category);
    expect(matching, "one category, not two").toHaveLength(1);
  });

  test("a cashier cannot import a menu", async ({ browser, baseURL }) => {
    // menu.manage, the same permission as adding a single item — this is that action repeated, and
    // a till operator holding it would be able to rewrite the prices they sell at.
    const ctx = await browser.newContext({ storageState: authFile("cashier"), baseURL });
    const request = ctx.request;
    const { res } = await importCsv(request, `${HEADER}\nAnything,Nope,,100,`);
    expect(res.status(), "importing without menu.manage must be refused").toBe(403);
    await ctx.close();
  });
});
