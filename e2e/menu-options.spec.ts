import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Sizes and add-ons: creating them, and what the till does with them.
 *
 * Both have been in the schema and priced by the order engine since the beginning, with no API and
 * no screen — the only way to give an item a second size was to write to the database by hand. This
 * covers the editor that fixes that, and, more importantly, the validation that had never existed
 * because nothing could create the data to exercise it:
 *
 *   - a modifier could be applied to any item, whether or not the item offered it. Deltas may be
 *     negative, so that priced an expensive dish with a discount option from elsewhere on the menu.
 *   - a variant could come from a different item in the same order and be priced by its delta.
 *   - minSelect/maxSelect were stored, shown to the kitchen, and never once checked.
 *
 * Works on its own fixture item, reused across runs by name: there is no DELETE for menu items, so
 * creating a fresh one per run would leave a trail through the demo menu.
 */

const PROBE_CATEGORY = "E2E Options";
const PROBE_ITEM = "E2E Options Probe";
const PROBE_PRICE = 50_000; // Rs 500

async function findOrCreateProbeItem(request: APIRequestContext): Promise<string> {
  const menu = await request.get("/api/menu");
  expect(menu.ok(), await menu.text()).toBeTruthy();
  const categories = (await menu.json()).categories as { id: string; name: string; items: { id: string; name: string }[] }[];

  const existing = categories.flatMap((c) => c.items).find((i) => i.name === PROBE_ITEM);
  if (existing) return existing.id;

  let categoryId = categories.find((c) => c.name === PROBE_CATEGORY)?.id;
  if (!categoryId) {
    const created = await request.post("/api/menu", { data: { name: PROBE_CATEGORY } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const body = await created.json();
    categoryId = body.id ?? body.category?.id;
  }

  const item = await request.post("/api/menu-items", {
    data: { categoryId, name: PROBE_ITEM, basePricePaisa: PROBE_PRICE },
  });
  expect(item.ok(), await item.text()).toBeTruthy();
  const body = await item.json();
  return body.item?.id ?? body.id;
}

/** Leaves the probe item with no sizes and no add-ons, whatever a previous run did to it. */
async function resetProbe(request: APIRequestContext, itemId: string) {
  const variants = await request.get(`/api/menu-items/${itemId}/variants`);
  if (variants.ok()) {
    for (const v of (await variants.json()).variants ?? []) {
      await request.delete(`/api/variants/${v.id}`);
    }
  }
  await request.put(`/api/menu-items/${itemId}/modifier-groups`, { data: { groupIds: [] } });
}

test.describe("Sizes and add-ons", () => {
  test.use({ storageState: authFile("owner") });
  // Each test walks several routes that the dev server compiles on first use, and the fixture reset
  // adds a few more round trips before the test body starts. The default 60s is not a budget, it is
  // a coin toss.
  test.describe.configure({ timeout: 150_000 });

  let itemId: string;

  test.beforeEach(async ({ request }) => {
    itemId = await findOrCreateProbeItem(request);
    await resetProbe(request, itemId);
  });

  test("a size is entered as what it costs, not as a difference from the base price", async ({ request }) => {
    // The schema stores a delta. Nobody types a menu in by working out deltas, so the API takes the
    // real price — and has to hand the same number back, or the screen shows one price and the till
    // charges another.
    const small = await request.post(`/api/menu-items/${itemId}/variants`, {
      data: { name: "12oz", pricePaisa: PROBE_PRICE },
    });
    expect(small.ok(), await small.text()).toBeTruthy();
    expect((await small.json()).variant.pricePaisa).toBe(PROBE_PRICE);

    const large = await request.post(`/api/menu-items/${itemId}/variants`, {
      data: { name: "16oz", pricePaisa: PROBE_PRICE + 15_000 },
    });
    expect(large.ok(), await large.text()).toBeTruthy();
    const largeVariant = (await large.json()).variant;
    expect(largeVariant.pricePaisa, "the price back out must be the price put in").toBe(PROBE_PRICE + 15_000);

    // The first size added becomes the default, so the till never has sizes and nothing preselected.
    const listed = (await (await request.get(`/api/menu-items/${itemId}/variants`)).json()).variants;
    expect(listed).toHaveLength(2);
    expect(listed.find((v: { name: string }) => v.name === "12oz").isDefault).toBe(true);

    // And the till charges it: ordering the 16oz must cost the 16oz price.
    const order = await request.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `size-${uniqueSuffix()}`,
        lines: [{ menuItemId: itemId, quantity: 1, variantId: largeVariant.id }],
      },
    });
    expect(order.ok(), await order.text()).toBeTruthy();
    expect((await order.json()).order.subtotalPaisa).toBe(PROBE_PRICE + 15_000);
  });

  test("two sizes cannot share a name", async ({ request }) => {
    // The till shows the sizes as buttons and the receipt prints the name. Two called "16oz" is a
    // question the cashier cannot answer and a receipt nobody can reconcile.
    await request.post(`/api/menu-items/${itemId}/variants`, { data: { name: "16oz", pricePaisa: PROBE_PRICE } });
    const dupe = await request.post(`/api/menu-items/${itemId}/variants`, {
      data: { name: "16OZ", pricePaisa: PROBE_PRICE + 100 },
    });
    expect(dupe.status(), "a duplicate size name must be refused").toBe(400);
  });

  test("a size from another item cannot be applied to this one", async ({ request }) => {
    // Variants for every item in an order are loaded together and were looked up by id alone, so a
    // line could carry a different item's size and be priced by its delta.
    const other = await request.post(`/api/menu-items/${itemId}/variants`, {
      data: { name: "Borrowed", pricePaisa: PROBE_PRICE },
    });
    expect(other.ok()).toBeTruthy();
    const borrowedId = (await other.json()).variant.id;

    const menu = await request.get("/api/menu");
    const victim = ((await menu.json()).categories as { items: { id: string; name: string }[] }[])
      .flatMap((c) => c.items)
      .find((i) => i.id !== itemId);
    expect(victim, "need a second menu item for this test").toBeTruthy();

    // Both items in one order, which is what makes this reachable: sizes are loaded for every item
    // in the order at once, and the lookup was by id alone. One line legitimately carries the probe
    // item, the other tries to wear its size.
    const order = await request.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `foreign-size-${uniqueSuffix()}`,
        lines: [
          { menuItemId: itemId, quantity: 1, variantId: borrowedId },
          { menuItemId: victim!.id, quantity: 1, variantId: borrowedId },
        ],
      },
    });
    expect(order.status(), "a size belonging to another item must be refused").toBe(400);
    expect(await order.text()).toMatch(/does not belong/i);

    // A size id that is not in the order at all is refused too, by the other branch.
    const unknown = await request.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `unknown-size-${uniqueSuffix()}`,
        lines: [{ menuItemId: victim!.id, quantity: 1, variantId: borrowedId }],
      },
    });
    expect(unknown.status()).toBe(400);
    expect(await unknown.text()).toMatch(/unknown size/i);
  });

  test("an add-on group is enforced: required, capped, and only on items that offer it", async ({ request }) => {
    const groupRes = await request.post("/api/modifier-groups", {
      data: { name: `Probe Serve ${uniqueSuffix()}`, minSelect: 1, maxSelect: 1 },
    });
    expect(groupRes.ok(), await groupRes.text()).toBeTruthy();
    const groupId = (await groupRes.json()).group.id;

    const hot = await request.post(`/api/modifier-groups/${groupId}/modifiers`, {
      data: { name: "Hot", priceDeltaPaisa: 0 },
    });
    const iced = await request.post(`/api/modifier-groups/${groupId}/modifiers`, {
      data: { name: "Iced", priceDeltaPaisa: 5_000 },
    });
    expect(hot.ok() && iced.ok(), "both options should be created").toBeTruthy();
    const hotId = (await hot.json()).modifier.id;
    const icedId = (await iced.json()).modifier.id;

    try {
      // Not offered by the item yet — so it must not be applicable to it.
      const beforeAttach = await request.post("/api/orders", {
        data: {
          type: "TAKEAWAY",
          idempotencyKey: `unoffered-${uniqueSuffix()}`,
          lines: [{ menuItemId: itemId, quantity: 1, modifierIds: [icedId] }],
        },
      });
      expect(beforeAttach.status(), "an add-on the item does not offer must be refused").toBe(400);
      expect(await beforeAttach.text()).toMatch(/not available on/i);

      const attach = await request.put(`/api/menu-items/${itemId}/modifier-groups`, { data: { groupIds: [groupId] } });
      expect(attach.ok(), await attach.text()).toBeTruthy();

      // minSelect is 1, so leaving it out is not a cheaper order — it is not an order.
      const missing = await request.post("/api/orders", {
        data: {
          type: "TAKEAWAY",
          idempotencyKey: `missing-${uniqueSuffix()}`,
          lines: [{ menuItemId: itemId, quantity: 1 }],
        },
      });
      expect(missing.status(), "a required choice must be required").toBe(400);
      expect(await missing.text()).toMatch(/choose at least 1/i);

      // maxSelect is 1, so two is refused too.
      const tooMany = await request.post("/api/orders", {
        data: {
          type: "TAKEAWAY",
          idempotencyKey: `toomany-${uniqueSuffix()}`,
          lines: [{ menuItemId: itemId, quantity: 1, modifierIds: [hotId, icedId] }],
        },
      });
      expect(tooMany.status(), "more than the maximum must be refused").toBe(400);
      expect(await tooMany.text()).toMatch(/at most 1/i);

      // And the accepted one is priced with the add-on included.
      const ok = await request.post("/api/orders", {
        data: {
          type: "TAKEAWAY",
          idempotencyKey: `ok-${uniqueSuffix()}`,
          lines: [{ menuItemId: itemId, quantity: 1, modifierIds: [icedId] }],
        },
      });
      expect(ok.ok(), await ok.text()).toBeTruthy();
      expect((await ok.json()).order.subtotalPaisa, "the add-on's price should be on the line").toBe(
        PROBE_PRICE + 5_000
      );
    } finally {
      await request.put(`/api/menu-items/${itemId}/modifier-groups`, { data: { groupIds: [] } });
      await request.delete(`/api/modifier-groups/${groupId}`);
    }
  });

  test("a group cannot be attached, or emptied, into a state that makes the item unorderable", async ({ request }) => {
    // A group demanding one choice while holding none blocks every item offering it. Both the
    // attach and the last delete have to refuse, or the owner breaks their own menu from the
    // add-ons screen and only finds out at the till.
    const groupRes = await request.post("/api/modifier-groups", {
      data: { name: `Probe Empty ${uniqueSuffix()}`, minSelect: 1, maxSelect: 1 },
    });
    const groupId = (await groupRes.json()).group.id;

    try {
      const attachEmpty = await request.put(`/api/menu-items/${itemId}/modifier-groups`, {
        data: { groupIds: [groupId] },
      });
      expect(attachEmpty.status(), "attaching an unsatisfiable group must be refused").toBe(400);
      expect(await attachEmpty.text()).toMatch(/only has 0/i);

      const only = await request.post(`/api/modifier-groups/${groupId}/modifiers`, {
        data: { name: "Only choice", priceDeltaPaisa: 0 },
      });
      const onlyId = (await only.json()).modifier.id;

      const removeLast = await request.delete(`/api/modifiers/${onlyId}`);
      expect(removeLast.status(), "removing the last required option must be refused").toBe(400);
      expect(await removeLast.text()).toMatch(/lower the minimum/i);
    } finally {
      await request.delete(`/api/modifier-groups/${groupId}`);
    }
  });

  test("retiring a size leaves what was already sold exactly as it was sold", async ({ request }) => {
    // OrderLine.variantId is a plain column and the line carries its own name and price, so a menu
    // tidy-up must not rewrite yesterday's receipts.
    const created = await request.post(`/api/menu-items/${itemId}/variants`, {
      data: { name: "Retiring", pricePaisa: PROBE_PRICE + 7_000 },
    });
    const variantId = (await created.json()).variant.id;

    const order = await request.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `retire-${uniqueSuffix()}`,
        lines: [{ menuItemId: itemId, quantity: 1, variantId }],
      },
    });
    expect(order.ok(), await order.text()).toBeTruthy();
    const orderId = (await order.json()).order.id;

    const removed = await request.delete(`/api/variants/${variantId}`);
    expect(removed.ok(), await removed.text()).toBeTruthy();

    // There is no GET for a single order; the list endpoint is the one that returns lines.
    const after = await request.get("/api/orders");
    expect(after.ok(), await after.text()).toBeTruthy();
    const orders = (await after.json()).orders as { id: string; lines: { nameSnapshot: string; unitPricePaisa: number }[] }[];
    const sold = orders.find((o) => o.id === orderId);
    expect(sold, "the order we just placed should be listed").toBeTruthy();
    const line = sold!.lines[0];
    expect(line.nameSnapshot, "the sold name must survive the size being retired").toContain("Retiring");
    expect(line.unitPricePaisa).toBe(PROBE_PRICE + 7_000);
  });
});
