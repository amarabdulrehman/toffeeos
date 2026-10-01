import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * Editing and deleting a menu item.
 *
 * An item could be created but never renamed, repriced, moved or removed. "Delete" archives rather
 * than erases: every order that sold the dish points at it, and the sales reports group by its
 * category through that link, so erasing it would rewrite history. What is asserted is that it is
 * gone from everywhere a new order could come from, and that the past is untouched.
 */

test.use({ storageState: authFile("owner") });

async function firstCategoryId(request: APIRequestContext): Promise<string> {
  const { categories } = await (await request.get("/api/menu")).json();
  return categories[0].id as string;
}

async function makeItem(request: APIRequestContext, name: string, pricePaisa = 50_000) {
  const res = await request.post("/api/menu-items", {
    data: { name, categoryId: await firstCategoryId(request), basePricePaisa: pricePaisa },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

/** Deleted items are archived, so tests clean up for real underneath the API. */
async function purge(id: string) {
  await withDb(async (c) => {
    const inUse = await c.query('SELECT 1 FROM "OrderLine" WHERE "menuItemId" = $1 LIMIT 1', [id]);
    if (inUse.rowCount === 0) await c.query('DELETE FROM "MenuItem" WHERE id = $1', [id]);
  });
}

async function onTill(request: APIRequestContext, id: string) {
  const { categories } = await (await request.get("/api/menu")).json();
  return (categories as { items: { id: string; name: string; basePricePaisa: number }[] }[])
    .flatMap((c) => c.items)
    .find((i) => i.id === id);
}

test("an item can be renamed, repriced and given a description", async ({ request }) => {
  const id = await makeItem(request, `E2E Edit ${uniqueSuffix()}`);
  try {
    const newName = `E2E Renamed ${uniqueSuffix()}`;
    const res = await request.patch(`/api/menu-items/${id}`, {
      data: { name: newName, basePricePaisa: 65_000, description: "Slow cooked" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const till = await onTill(request, id);
    expect(till?.name).toBe(newName);
    expect(till?.basePricePaisa).toBe(65_000);

    // The before figure is kept, because a price change is what gets questioned later.
    const audit = await withDb(async (c) =>
      (
        await c.query(
          `SELECT metadata FROM "AuditLog" WHERE action = 'menu_item.update' AND "entityId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
          [id]
        )
      ).rows[0]?.metadata
    );
    expect(audit.before.basePricePaisa).toBe(50_000);
    expect(audit.changes.basePricePaisa).toBe(65_000);
  } finally {
    await purge(id);
  }
});

test("an edit is refused for a category that isn't real, and for an empty change", async ({ request }) => {
  const id = await makeItem(request, `E2E Bad ${uniqueSuffix()}`);
  try {
    expect((await request.patch(`/api/menu-items/${id}`, { data: { categoryId: "no-such-category" } })).status()).toBe(404);
    expect((await request.patch(`/api/menu-items/${id}`, { data: {} })).status()).toBe(400);
    expect((await request.patch(`/api/menu-items/${id}`, { data: { basePricePaisa: -1 } })).status()).toBe(400);
  } finally {
    await purge(id);
  }
});

test("deleting takes it off the till and the menu list, and keeps past orders intact", async ({ request }) => {
  const id = await makeItem(request, `E2E Delete ${uniqueSuffix()}`);
  try {
    // Sell it once, so there is history to protect.
    const order = await request.post("/api/orders", {
      data: { type: "TAKEAWAY", idempotencyKey: `e2e-${uniqueSuffix()}`, lines: [{ menuItemId: id, quantity: 1 }] },
    });
    expect(order.ok(), await order.text()).toBeTruthy();
    const orderId = (await order.json()).order.id as string;

    const del = await request.delete(`/api/menu-items/${id}`);
    expect(del.ok(), await del.text()).toBeTruthy();

    expect(await onTill(request, id), "gone from the till").toBeUndefined();
    const { items } = await (await request.get("/api/menu-items")).json();
    expect((items as { id: string }[]).some((i) => i.id === id), "gone from the menu screen").toBe(false);

    // The order that sold it still has its line, under the name it was sold as.
    const line = await withDb(async (c) =>
      (await c.query('SELECT "nameSnapshot" FROM "OrderLine" WHERE "orderId" = $1 AND "menuItemId" = $2', [orderId, id])).rows[0]
    );
    expect(line?.nameSnapshot).toMatch(/E2E Delete/);

    // And a second delete, or an edit, finds nothing to act on.
    expect((await request.delete(`/api/menu-items/${id}`)).status()).toBe(404);
    expect((await request.patch(`/api/menu-items/${id}`, { data: { name: "x" } })).status()).toBe(404);
  } finally {
    await purge(id);
  }
});

test("a cashier can't edit or delete menu items", async ({ browser, baseURL, request }) => {
  const id = await makeItem(request, `E2E Perm ${uniqueSuffix()}`);
  const ctx = await browser.newContext({ baseURL, storageState: authFile("cashier") });
  try {
    expect((await ctx.request.patch(`/api/menu-items/${id}`, { data: { basePricePaisa: 1 } })).status()).toBe(403);
    expect((await ctx.request.delete(`/api/menu-items/${id}`)).status()).toBe(403);
  } finally {
    await ctx.close();
    await purge(id);
  }
});

test("the menu screen edits and deletes through the dialogs", async ({ page, request }) => {
  const name = `E2E UI ${uniqueSuffix()}`;
  const id = await makeItem(request, name);
  try {
    await page.goto("/app/menu");
    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: "Edit details" }).click();
    const edit = page.getByRole("dialog", { name: new RegExp(`Edit ${name}`) });
    await edit.getByLabel("Price (Rs)").fill("725");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(row.getByText("Rs 725")).toBeVisible();

    await row.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete item" }).click();
    await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
  } finally {
    await purge(id);
  }
});

/**
 * Deleting an item and then importing a menu that has it.
 *
 * The import works out what "already exists" by category and name. It counted deleted items too,
 * which never mattered while nothing could be deleted. Once something could, two things went wrong:
 * a deleted dish in the file was taken as already on the menu and never came back, and a dish that
 * was deleted and then added again by hand had a hidden twin with the same name, so the import's
 * price change could land on the hidden one while the visible one kept its old price.
 */
async function importCsv(request: APIRequestContext, csv: string) {
  const res = await request.post("/api/menu/import", { data: { csv } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

async function createCategory(request: APIRequestContext, name: string) {
  const res = await request.post("/api/menu", { data: { name } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("importing after a delete", () => {
  test("a deleted item in the file comes back on the menu", async ({ request }) => {
    const category = `E2E Reimport ${uniqueSuffix()}`;
    const name = "Comeback Dish";
    await importCsv(request, `Category,Item,Size,Price,Description\n${category},${name},,500,`);
    const first = await withDb(async (c) =>
      (await c.query('SELECT id FROM "MenuItem" WHERE name = $1 AND "isActive" ORDER BY "createdAt" DESC LIMIT 1', [name])).rows[0].id
    );
    const ids = [first as string];
    try {
      expect((await request.delete(`/api/menu-items/${first}`)).ok()).toBeTruthy();

      await importCsv(request, `Category,Item,Size,Price,Description\n${category},${name},,650,`);

      const { items } = await (await request.get("/api/menu-items")).json();
      const live = (items as { id: string; name: string; categoryName: string; basePricePaisa: number }[]).filter(
        (i) => i.name === name && i.categoryName === category
      );
      ids.push(...live.map((l) => l.id));
      expect(live, "the dish must be back on the menu").toHaveLength(1);
      expect(live[0].basePricePaisa).toBe(65_000);
    } finally {
      for (const id of ids) await purge(id);
    }
  });

  test("a price change in the file reaches the visible item, not a deleted twin", async ({ request }) => {
    const category = `E2E Twin ${uniqueSuffix()}`;
    const name = "Twin Dish";
    await createCategory(request, category);
    const categoryId = await withDb(async (c) =>
      (await c.query('SELECT id FROM "Category" WHERE name = $1 LIMIT 1', [category])).rows[0].id as string
    );
    const mk = async () => {
      const r = await request.post("/api/menu-items", { data: { name, categoryId, basePricePaisa: 50_000 } });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).id as string;
    };
    // Delete, then add again by hand — exactly what an owner does to "reset" an item.
    const deleted = await mk();
    expect((await request.delete(`/api/menu-items/${deleted}`)).ok()).toBeTruthy();
    const visible = await mk();
    try {
      await importCsv(request, `Category,Item,Size,Price,Description\n${category},${name},,725,`);
      const prices = await withDb(async (c) =>
        Object.fromEntries(
          (await c.query('SELECT id, "basePricePaisa" FROM "MenuItem" WHERE id = ANY($1)', [[deleted, visible]])).rows.map(
            (r) => [r.id, r.basePricePaisa]
          )
        )
      );
      expect(prices[visible], "the item on the menu gets the new price").toBe(72_500);
      expect(prices[deleted], "the deleted one is left alone").toBe(50_000);
    } finally {
      await purge(deleted);
      await purge(visible);
    }
  });
});
