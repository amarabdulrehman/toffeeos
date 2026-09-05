import { test, expect, type Page } from "@playwright/test";
import { authFile, SEED_MENU_ITEM_2 } from "./fixtures/test-data";
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
  await selectTable(page, table.label);
  await expect(page.getByText("Add items")).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();

  await page.getByRole("button", { name: "Add items" }).click();
  await expect(page.getByText(/Adding to Order/)).toBeVisible();

  // Entering "add items" mode itself is allowed offline (it's just local cart state) — the
  // documented, deliberate limitation (addLinesToOrder isn't one of the offline queue's three
  // action types) only bites on submit. This must degrade to a clear message, never a silent
  // failure or a crash.
  await page.getByRole("button", { name: SEED_MENU_ITEM_2.name, exact: false }).first().click();
  await page.getByRole("button", { name: "Send to Kitchen" }).click();
  await expect(page.getByText(/needs a connection/i)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  await page.context().setOffline(false);
});
