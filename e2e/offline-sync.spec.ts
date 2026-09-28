import { test, expect, type Page } from "@playwright/test";
import { authFile, SEED_MENU_CATEGORY, SEED_MENU_ITEM_2 } from "./fixtures/test-data";
import { getAvailableTable, getOrder } from "./fixtures/api";

/**
 * Real offline/online transitions via Playwright's network emulation (CDP-level — this actually
 * blocks real requests and flips navigator.onLine/fires real browser events, unlike a hand-rolled
 * Object.defineProperty stand-in, which is what earlier manual testing used and which never
 * actually cut the network). That distinction mattered: it's what surfaced a real bug — the table
 * picker had no offline cache fallback at all (fixed in src/components/pos/tables-dialog.tsx,
 * alongside this suite) — that the JS-only fake could never have caught, because the "offline"
 * fetches it faced were never actually blocked.
 *
 * Covers the two action types the offline queue actually supports (create + pay — see
 * src/lib/offline/queue.ts's own comment on why addLinesToOrder isn't a third) and confirms the
 * one documented unsupported case fails softly.
 */
test.use({ storageState: authFile("owner") });

/** Table buttons render as "{label}\n{seats} seats" — matching just `label` as substring text
 * would ambiguously hit both "T1" and "T10". Anchoring at the start with a word boundary avoids it. */
async function selectTable(page: Page, label: string) {
  // The trigger reads "Select a table" the first time, but "Table {label}" once one is already
  // set (e.g. re-opening the picker to resume/switch) — match either so this helper works both
  // times it's called in a single test.
  //
  // The dialog's `floors` state persists across close/reopen and only refreshes once its own
  // `fetch("/api/tables")` resolves — a table button from the *previous* fetch can already be
  // present and clickable before that refresh lands, so clicking without waiting for the response
  // risks acting on stale status (e.g. "AVAILABLE" from before this table's order existed), taking
  // the wrong branch in handleTap and silently starting a new order instead of resuming. Waiting
  // for the response here is what actually caught that race.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/tables") && r.request().method() === "GET"),
    page.getByRole("button", { name: /^(Select a table|Table )/ }).click(),
  ]);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
}

test("an order punched and sent to kitchen while offline queues locally, then syncs once back online", async ({
  page,
  request,
}) => {
  const table = await getAvailableTable(request);

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });

  // Select the table and add an item while genuinely online — this is also what populates the
  // tables cache the fix above relies on, matching how a real shift actually starts.
  await selectTable(page, table.label);
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();
  await expect(page.getByText("Subtotal")).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  await page.getByRole("button", { name: "Send to Kitchen" }).click();
  await expect(page.getByText(/unsynced/)).toBeVisible();

  // The order must genuinely not exist server-side yet — that's the whole point of "offline," and
  // this check itself needs a real (still-online) request context, separate from the offline page.
  const ordersWhileOffline = await request.get("/api/orders");
  const beforeSync = await ordersWhileOffline.json();
  const openOrderTables = beforeSync.orders
    .filter((o: { status: string }) => o.status !== "PAID")
    .map((o: { table?: { label: string } }) => o.table?.label);
  expect(openOrderTables).not.toContain(table.label);

  await page.context().setOffline(false);

  // Poll the server directly rather than trusting the "Online — all orders synced" text to *stay*
  // true — the client's very first replay attempt right after setOffline(false) can itself
  // transiently fail (Chrome's own network-stack restoration isn't instant), and useSync's 15s
  // periodic retry is the documented recovery path for exactly that, not a bug. See the payment
  // test below for the same pattern with a fuller explanation.
  async function findSyncedOrder() {
    const res = await request.get("/api/orders");
    const { orders } = await res.json();
    return orders.find(
      (o: { table?: { label: string }; status: string }) => o.table?.label === table.label && o.status === "SENT_TO_KITCHEN"
    );
  }
  await expect.poll(findSyncedOrder, { timeout: 20_000, intervals: [1000] }).toBeTruthy();

  const synced = await findSyncedOrder();
  expect(synced.lines.some((l: { nameSnapshot: string }) => l.nameSnapshot === SEED_MENU_ITEM_2.name)).toBe(true);
});

test("paying an order while offline syncs with the exact charged amount, no drift", async ({ page, request }) => {
  const table = await getAvailableTable(request);

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });

  // Create and send the order online first so its total is known, then go offline only for the
  // payment step itself.
  await selectTable(page, table.label);
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();

  const [sendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/send-to-kitchen")),
    page.getByRole("button", { name: "Send to Kitchen" }).click(),
  ]);
  const orderId: string = (await sendResponse.json()).order.id;
  const orderBefore = await getOrder(request, orderId);

  // Open (and thereby cache) the order queue once while still online, same reasoning as the
  // table cache above.
  await page.getByRole("button", { name: "Order Queue" }).click();
  await expect(page.getByText(`#${orderBefore.orderNumber}`)).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  // Each queue row is a single <div className="rounded-xl border ..."> wrapping its own order
  // number and action buttons (src/components/pos/order-queue-panel.tsx) — scoping by that class
  // plus the order number text is more robust than counting DOM ancestor levels.
  const queueRow = page.locator("div.rounded-xl", { hasText: `#${orderBefore.orderNumber}` });
  await queueRow.getByRole("button", { name: "Payment" }).click();
  await page.getByRole("dialog", { name: "Take payment" }).getByRole("button", { name: "Confirm payment" }).click();

  await page.context().setOffline(false);

  // The client's first replay attempt right after setOffline(false) can itself transiently fail
  // (observed directly: net::ERR_INTERNET_DISCONNECTED on the very next request, presumably a
  // brief propagation delay in Chrome's own network-stack restoration) — useSync's own comment
  // calls this out explicitly ("the `online` event can fire without connectivity actually being
  // usable") and its 15s periodic retry is the documented recovery path, not a bug. Polling the
  // server (the authoritative source) rather than trusting the UI's "synced" text to *stay* true
  // avoids a flaky assertion on that same transient flicker.
  await expect
    .poll(async () => (await getOrder(request, orderId)).status, { timeout: 20_000, intervals: [1000] })
    .toBe("PAID");

  const orderAfter = await getOrder(request, orderId);
  expect(orderAfter.paidPaisa).toBe(orderAfter.totalPaisa);
  expect(orderAfter.totalPaisa).toBe(orderBefore.totalPaisa);
});

test("adding items to an already-sent order while offline fails softly, no crash", async ({ page, request }) => {
  const table = await getAvailableTable(request);

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });

  await selectTable(page, table.label);
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();
  // Wait for the actual send-to-kitchen response, not just "all orders synced" — that text can
  // already be true before this specific request even lands, which raced the table's status
  // update against the next step (re-opening the picker saw the table as still AVAILABLE and
  // started a fresh empty order instead of resuming this one).
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/send-to-kitchen") && r.ok()),
    page.getByRole("button", { name: "Send to Kitchen" }).click(),
  ]);

  // Resume the order we just sent by picking its table again (also while online, caching it).
  //
  // Confirm the table actually reads as occupied first. selectTable already waits for the picker's
  // own /api/tables response, but under a full-suite run that can resolve against an earlier
  // in-flight refresh, and then the dialog clicks a table it still believes is AVAILABLE — which
  // starts a fresh order instead of resuming, and surfaces here as "Add items" never appearing.
  // Waiting on committed server state first means any refresh the dialog makes returns the truth.
  await expect
    .poll(
      async () => {
        const { floors } = await (await request.get("/api/tables")).json();
        return floors
          .flatMap((f: { tables: { id: string; status: string }[] }) => f.tables)
          .find((t: { id: string }) => t.id === table.id)?.status;
      },
      { timeout: 20_000 }
    )
    .not.toBe("AVAILABLE");

  await selectTable(page, table.label);
  await expect(page.getByText("Add items")).toBeVisible({ timeout: 15_000 });

  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  await page.getByRole("button", { name: "Add items" }).click();
  await expect(page.getByText(/Adding to Order/)).toBeVisible();

  // Entering "add items" mode itself is allowed offline (it's just local cart state) — the
  // documented, deliberate limitation (addLinesToOrder isn't one of the offline queue's three
  // action types) only bites on submit. This must degrade to a clear message, never a silent
  // failure or a crash.
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();
  await page.getByRole("button", { name: "Send to Kitchen" }).click();
  await expect(page.getByText(/needs a connection/i)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  await page.context().setOffline(false);
});

test("an add-on chosen offline survives the sync, at the price the cashier charged", async ({ page, request }) => {
  test.setTimeout(150_000);
  /**
   * The bug this exists for: CreateOrderPayload declared modifierIds from the day the offline queue
   * was written, and queueCreateOrder never filled it in. An order punched during an outage with an
   * extra shot on it therefore replayed without the extra shot — the cashier had charged for it
   * from the local total, the server recomputed a cheaper line, and nothing anywhere reported a
   * difference. A customer undercharged and a kitchen ticket missing what they ordered, silently.
   *
   * Needs its own item rather than a seeded one: attaching an add-on group to a shared menu item
   * would make every other spec's single tap open a size-and-add-ons dialog instead of adding a
   * line.
   */
  const suffix = Math.random().toString(36).slice(2, 8);
  const categoryRes = await request.post("/api/menu", { data: { name: `E2E Offline Add-ons ${suffix}` } });
  expect(categoryRes.ok(), await categoryRes.text()).toBeTruthy();
  const categoryBody = await categoryRes.json();
  const categoryId = categoryBody.id ?? categoryBody.category?.id;

  const itemName = `Offline Addon Probe ${suffix}`;
  const itemRes = await request.post("/api/menu-items", {
    data: { categoryId, name: itemName, basePricePaisa: 50_000 },
  });
  expect(itemRes.ok(), await itemRes.text()).toBeTruthy();
  const itemBody = await itemRes.json();
  const menuItemId = itemBody.item?.id ?? itemBody.id;

  const groupRes = await request.post("/api/modifier-groups", {
    data: { name: `Offline Extras ${suffix}`, minSelect: 0, maxSelect: 1 },
  });
  expect(groupRes.ok(), await groupRes.text()).toBeTruthy();
  const groupId = (await groupRes.json()).group.id;
  await request.post(`/api/modifier-groups/${groupId}/modifiers`, {
    data: { name: "Extra Shot", priceDeltaPaisa: 10_000 },
  });
  await request.put(`/api/menu-items/${menuItemId}/modifier-groups`, { data: { groupIds: [groupId] } });

  const table = await getAvailableTable(request);

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
  await selectTable(page, table.label);

  // Offline before the item is even chosen, so the whole interaction — dialog included — happens
  // with the network genuinely cut.
  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  // The grid shows one category at a time, so the pill has to be picked before the item exists on
  // screen. Both were cached while online, so this works with the network cut.
  await page.getByRole("button", { name: `E2E Offline Add-ons ${suffix}`, exact: false }).first().click();
  await page.getByRole("button", { name: itemName, exact: false }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Extra Shot/ }).click();
  await dialog.getByRole("button", { name: "Add to order" }).click();

  // Rs 500 + Rs 100. If the local total does not already include the add-on, the rest of this test
  // proves nothing about the sync.
  // Appears on both the cart line and the subtotal, which is itself the point — the local price
  // already carries the add-on before anything is queued.
  await expect(page.getByText("Rs 600").first()).toBeVisible();

  // The note rides the same payload as the add-on and was missing for the same reason, so it is
  // worth proving on the path where a dropped field is hardest to notice.
  const note = `No sugar ${suffix}`;
  await page.getByRole("button", { name: `Note for ${itemName}`, exact: false }).first().click();
  await page.getByRole("textbox", { name: `Note for ${itemName}`, exact: false }).first().fill(note);

  await page.getByRole("button", { name: "Send to Kitchen" }).click();
  await expect(page.getByText(/unsynced/)).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 30_000 });

  // The server's own copy, after replay — not the browser's optimistic one.
  const orders = await (await request.get("/api/orders")).json();
  const synced = (orders.orders as { id: string; lines: { nameSnapshot: string; unitPricePaisa: number }[]; tableId: string }[])
    .find((o) => o.tableId === table.id && o.lines.some((l) => l.nameSnapshot.includes(itemName)));
  expect(synced, "the offline order should have reached the server").toBeTruthy();

  const line = synced!.lines.find((l) => l.nameSnapshot.includes(itemName))!;
  expect(line.unitPricePaisa, "the add-on must survive the replay, or the customer is undercharged").toBe(60_000);

  // Then the other half of the same bug: the money being right is no use if the barista makes a
  // plain one. Asserted through the endpoint the kitchen screen actually reads, rather than the
  // line's name — a modifier is its own row, and the line is still called "Latte".
  const kds = await (await request.get("/api/kds/orders")).json();
  const kdsLine = (kds.orders as { id: string; lines: { nameSnapshot: string; notes: string | null; modifiers: { nameSnapshot: string }[] }[] }[])
    .find((o) => o.id === synced!.id)
    ?.lines.find((l) => l.nameSnapshot.includes(itemName));
  expect(kdsLine, "the order should be on the kitchen board").toBeTruthy();
  expect(kdsLine!.notes, "the note must survive the replay too").toBe(note);
  expect(
    kdsLine!.modifiers.map((m) => m.nameSnapshot),
    "and the kitchen must be told what was added to it"
  ).toContain("Extra Shot");
});

/**
 * What the offline "Take Payment" message tells a cashier to do: the order punched offline is in
 * the Order Queue straight away, cash can be taken for it there while still offline, and once the
 * connection is back the order and its payment both reach the server, the payment at exactly the
 * order's total. The test above pays offline an order created online; this one pays an order that
 * never reached the server before it was paid.
 */
test("an order punched with Take Payment while offline can be paid in cash from the Order Queue straight away", async ({
  page,
  request,
}) => {
  const table = await getAvailableTable(request);
  const idsBefore = new Set(((await (await request.get("/api/orders")).json()).orders as { id: string }[]).map((o) => o.id));

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
  await selectTable(page, table.label);
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();
  await expect(page.getByText("Subtotal")).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  await page.getByRole("button", { name: "Take Payment" }).click();
  await expect(page.getByText(/Take cash for it from the Order Queue now/)).toBeVisible();

  await page.getByRole("button", { name: "Order Queue" }).click();
  const queueRow = page.locator("div.rounded-xl", { hasText: "#-1" });
  await queueRow.getByRole("button", { name: "Payment" }).click();
  await page.getByRole("dialog", { name: "Take payment" }).getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByText(/Payment for order #-1 queued offline/)).toBeVisible();

  await page.context().setOffline(false);

  type ListedOrder = { id: string; status: string; totalPaisa: number; paidPaisa: number; table?: { label: string } | null };
  async function findPaid(): Promise<ListedOrder | undefined> {
    const { orders } = (await (await request.get("/api/orders")).json()) as { orders: ListedOrder[] };
    return orders.find((o) => !idsBefore.has(o.id) && o.table?.label === table.label && o.status === "PAID");
  }
  // Same transient first-replay failure as the tests above; useSync's periodic retry recovers it.
  await expect.poll(findPaid, { timeout: 30_000, intervals: [1000] }).toBeTruthy();
  const paid = (await findPaid())!;
  expect(paid.paidPaisa).toBe(paid.totalPaisa);
});

/**
 * Offline, the payment dialog can't reprice for a method's own tax rate (only the server can,
 * through pay-preview), so it would ask a card for the order's cash-rate total. Measured before
 * this guard, a Rs 284 card-rate bill was charged Rs 305. So offline it takes cash only and says
 * why, and cash still syncs at exactly the total.
 */
test("offline, the payment dialog takes cash only, and says why", async ({ page, request }) => {
  const table = await getAvailableTable(request);

  await page.goto("/pos");
  await expect(page.getByText("Online — all orders synced")).toBeVisible({ timeout: 15_000 });
  await selectTable(page, table.label);
  await page.getByRole("button", { name: SEED_MENU_CATEGORY, exact: true }).first().click();
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();
  const [sendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/send-to-kitchen")),
    page.getByRole("button", { name: "Send to Kitchen" }).click(),
  ]);
  const orderId: string = (await sendResponse.json()).order.id;
  const before = await getOrder(request, orderId);
  await page.getByRole("button", { name: "Order Queue" }).click();
  await expect(page.getByText(`#${before.orderNumber}`)).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  const queueRow = page.locator("div.rounded-xl", { hasText: `#${before.orderNumber}` });
  await queueRow.getByRole("button", { name: "Payment" }).click();
  const dialog = page.getByRole("dialog", { name: "Take payment" });
  const confirm = dialog.getByRole("button", { name: "Confirm payment" });
  const onlyCash = dialog.getByText(/only cash can be taken/);

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Card", exact: true }).click();
  await expect(onlyCash).toBeVisible();
  await expect(confirm).toBeDisabled();

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await expect(onlyCash).toHaveCount(0);
  await confirm.click();

  await page.context().setOffline(false);
  await expect
    .poll(async () => (await getOrder(request, orderId)).status, { timeout: 30_000, intervals: [1000] })
    .toBe("PAID");
  const after = await getOrder(request, orderId);
  expect(after.paidPaisa).toBe(after.totalPaisa);
});
