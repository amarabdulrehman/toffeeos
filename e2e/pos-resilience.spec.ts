import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, TENANT_SLUG, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";
import { reclaimTables } from "./fixtures/reclaim-tables";

/**
 * A busy service, played against the till, looking for the one thing a café can't work around: the
 * POS screen falling over ("POS hit a problem").
 *
 * On 9 October 2026 a café saw exactly that, on and off, mid-service. It came from the browser,
 * not the server (no reference number), and browser errors weren't reaching Sentry, so nothing said
 * what broke. This makes the till go through what a real shift does, in a random order from a
 * fixed seed, while other devices keep changing the same orders underneath it: a waiter's phone,
 * the kitchen screen, online and QR customers, the internet dropping and the wifi staying up with
 * nothing behind it. After every step it checks the screen. A crash fails with the browser's own
 * error and the steps that led to it, and the seed replays the exact same run.
 *
 *   SEED=7 STEPS=300 npx playwright test e2e/pos-resilience.spec.ts --project=chromium
 */

const SEED = Number(process.env.SEED ?? 20261009);
const STEPS = Number(process.env.STEPS ?? 120);
const CRASHED = /hit a problem/;

// A short action timeout: a missing button skips the step instead of hanging the shift.
test.use({ storageState: authFile("owner"), actionTimeout: 5_000 });
test.setTimeout(Math.max(10 * 60_000, STEPS * 6_000));

/** Small and seedable, so a failing run can be replayed exactly. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("a busy service never takes the till down", async ({ page, baseURL }) => {
  const rand = mulberry32(SEED);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const chance = (p: number) => rand() < p;

  // What the browser itself reported: uncaught exceptions, and what the POS error screen logs.
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(`${e.name}: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 8).join("\n")}`));
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().startsWith("[POS]")) browserErrors.push(m.text());
  });

  const steps: string[] = [];
  const say = (s: string) => {
    steps.push(s);
    console.log(s);
  };

  /** After a reload or a trip away, the till has to be usable again — a blank page is a failure. */
  async function tillIsBack(after: string) {
    const ready = page.getByText(/Online — all orders synced|unsynced|You're offline/).first();
    await ready.waitFor({ timeout: 30_000 }).catch(() => {
      throw new Error(`The till didn't come back after ${after} (seed ${SEED}).\nLast steps:\n  ${steps.slice(-12).join("\n  ")}`);
    });
  }

  async function crashed(): Promise<boolean> {
    return (await page.getByText(CRASHED).count()) > 0;
  }

  // A part of the till that failed and was contained by its own boundary (it logs "[POS] …") is
  // still a failure here: the café wouldn't lose the screen, but something is broken.
  let errorsSeen = 0;
  async function assertStanding(after: string) {
    const newErrors = browserErrors.length > errorsSeen;
    errorsSeen = browserErrors.length;
    if (newErrors || (await crashed())) {
      throw new Error(
        [
          `The till crashed (seed ${SEED}) after: ${after}`,
          `Last steps:\n  ${steps.slice(-12).join("\n  ")}`,
          `Browser errors:\n${browserErrors.join("\n\n") || "(none captured)"}`,
        ].join("\n\n")
      );
    }
  }

  // ---- Other devices, changing the same orders underneath the till --------------------------------
  const waiter = await playwrightRequest.newContext({ baseURL, storageState: authFile("waiter") });
  const kitchen = await playwrightRequest.newContext({ baseURL, storageState: authFile("kitchen") });
  const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
  const anon = await playwrightRequest.newContext({ baseURL });
  const { branchId } = (await (await owner.get("/api/auth/session")).json()).user as { branchId: string };
  const itemIds = await Promise.all(["Beef Chapli Kebab", "Dahi Bhalla"].map((n) => getMenuItemId(owner, n)));

  async function availableTableId(ctx: APIRequestContext): Promise<string | null> {
    const res = await ctx.get("/api/tables");
    if (!res.ok()) return null;
    const { floors } = (await res.json()) as { floors: { tables: { id: string; status: string }[] }[] };
    const free = floors.flatMap((f) => f.tables).filter((t) => t.status === "AVAILABLE");
    return free.length ? pick(free).id : null;
  }

  async function openOrders(): Promise<{ id: string; status: string; totalPaisa: number; paidPaisa: number }[]> {
    const res = await owner.get("/api/orders?day=today");
    if (!res.ok()) return [];
    return ((await res.json()).orders ?? []).filter((o: { status: string }) => !["PAID", "VOIDED", "CANCELLED"].includes(o.status));
  }

  const elsewhere: Record<string, () => Promise<unknown>> = {
    "a waiter's phone sends a table order": async () => {
      const tableId = await availableTableId(waiter);
      if (!tableId) return;
      const res = await waiter.post("/api/orders", {
        data: { type: "DINE_IN", tableId, idempotencyKey: `res-w-${uniqueSuffix()}`, lines: [{ menuItemId: pick(itemIds), quantity: 1 + Math.floor(rand() * 3) }] },
      });
      if (res.ok()) await waiter.post(`/api/orders/${(await res.json()).order.id}/send-to-kitchen`, { data: {} });
    },
    "a QR table orders": async () => {
      const tableId = await availableTableId(owner);
      if (!tableId) return;
      await anon.post(`/api/online-order/${TENANT_SLUG}/qr-checkout`, {
        data: { tableId, customerName: "Resilience QR", idempotencyKey: `res-qr-${uniqueSuffix()}`, lines: [{ menuItemId: pick(itemIds), quantity: 1 }] },
      });
    },
    "an online pickup order arrives": async () => {
      await anon.post(`/api/online-order/${TENANT_SLUG}/checkout`, {
        data: {
          branchId,
          customerName: "Resilience Online",
          customerPhone: "03001234567",
          fulfillment: "PICKUP",
          lines: [{ menuItemId: pick(itemIds), quantity: 1 }],
          idempotencyKey: `res-on-${uniqueSuffix()}`,
        },
      });
    },
    "the kitchen marks an order ready": async () => {
      const res = await kitchen.get("/api/kds/orders");
      if (!res.ok()) return;
      const sent = ((await res.json()).orders ?? []).filter((o: { status: string }) => o.status === "SENT_TO_KITCHEN");
      if (sent.length) await kitchen.post(`/api/orders/${pick(sent as { id: string }[]).id}/ready`, { data: {} });
    },
    "another round goes on an open order": async () => {
      const open = await openOrders();
      if (open.length) {
        await owner.post(`/api/orders/${pick(open).id}/lines`, { data: { lines: [{ menuItemId: pick(itemIds), quantity: 1 }] } });
      }
    },
    "another till takes a payment": async () => {
      const open = (await openOrders()).filter((o) => o.paidPaisa === 0);
      if (!open.length) return;
      const o = pick(open);
      const method = pick(["CASH", "CARD"]);
      const preview = await owner.post(`/api/orders/${o.id}/pay-preview`, { data: { tenders: [{ method, amountPaisa: 0 }] } });
      if (!preview.ok()) return;
      const total = (await preview.json()).totals.totalPaisa as number;
      await owner.post(`/api/orders/${o.id}/pay`, { data: { tenders: [{ method, amountPaisa: total }] } });
    },
  };

  let traffic = true;
  const background = (async () => {
    while (traffic) {
      const [name, run] = pick(Object.entries(elsewhere));
      try {
        await run();
        say(`  (elsewhere: ${name})`);
      } catch {
        // Another device failing is not the till's problem.
      }
      await new Promise((r) => setTimeout(r, 1500 + rand() * 3000));
    }
  })();

  // ---- The till ----------------------------------------------------------------------------------
  const quick = { timeout: 4_000 };

  async function closeAnything() {
    for (let i = 0; i < 3; i++) await page.keyboard.press("Escape").catch(() => {});
  }

  async function addSomeItems() {
    // The menu's own pills and cards (product-grid.tsx), so a random tap never lands on Sign out.
    const categories = page.locator("button.min-h-11.rounded-full");
    const products = page.locator("button.min-h-28:not([disabled])");
    if (chance(0.6) && (await categories.count()) > 0) await categories.nth(Math.floor(rand() * (await categories.count()))).click(quick);
    const n = await products.count();
    if (!n) return;
    for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) {
      await products.nth(Math.floor(rand() * n)).click(quick);
      // Sizes and add-ons: choose whatever is offered first, then add.
      const add = page.getByRole("dialog").getByRole("button", { name: "Add to order" });
      if (await add.isVisible().catch(() => false)) {
        const options = page.getByRole("dialog").getByRole("button").filter({ hasNotText: /Add to order|Cancel|Close/ });
        if ((await options.count()) > 0 && chance(0.7)) await options.first().click(quick).catch(() => {});
        if (await add.isEnabled({ timeout: 2_000 }).catch(() => false)) await add.click(quick);
        else await closeAnything();
      }
    }
  }

  async function chooseTableOrTakeaway() {
    if (chance(0.5)) {
      await page.getByRole("combobox", { name: "Order type" }).click(quick);
      await page.getByRole("option", { name: pick(["Takeaway", "Dine-in"]) }).click(quick);
    }
    const tableButton = page.getByRole("button", { name: /^(Select a table|Table )/ });
    if (await tableButton.isVisible().catch(() => false)) {
      await tableButton.click(quick);
      const dialog = page.getByRole("dialog");
      const tables = dialog.getByRole("button").filter({ hasText: /seats/ });
      const n = await tables.count();
      if (n) await tables.nth(Math.floor(rand() * n)).click(quick);
      // An occupied table opens its order instead; that is a path worth walking too.
    }
  }

  async function pay() {
    const dialog = page.getByRole("dialog", { name: "Take payment" });
    await dialog.waitFor(quick);
    const method = pick(["Cash", "Cash", "Card", "JazzCash", "Easypaisa"]);
    if (method !== "Cash") {
      await dialog.getByRole("combobox").first().click(quick);
      await page.getByRole("option", { name: method, exact: true }).click(quick);
    }
    if (chance(0.25)) await dialog.getByRole("button", { name: /Split payment/ }).click(quick);
    if (chance(0.3)) await dialog.getByRole("spinbutton").last().fill(String(1000 + Math.floor(rand() * 9000))).catch(() => {});
    await page.waitForTimeout(400);
    const confirm = dialog.getByRole("button", { name: "Confirm payment" });
    if (chance(0.8) && (await confirm.isEnabled({ timeout: 2_000 }).catch(() => false))) await confirm.click(quick);
    else await closeAnything();
    await page.waitForTimeout(600);
    await closeAnything(); // the receipt, if one opened
  }

  async function queueRow() {
    const queue = page.getByRole("button", { name: /Order Queue/ });
    if (!(await page.getByRole("heading", { name: "Order Queue" }).isVisible().catch(() => false))) await queue.click(quick);
    const rows = page.locator("div.rounded-xl").filter({ has: page.getByText(/^#-?\d+/) });
    await page.waitForTimeout(500);
    const n = await rows.count();
    return n ? rows.nth(Math.floor(rand() * n)) : null;
  }

  let offline = false;
  let noInternet = false;
  const tillActions: Record<string, () => Promise<unknown>> = {
    "punch an order and send it to the kitchen": async () => {
      await addSomeItems();
      await chooseTableOrTakeaway();
      const send = page.getByRole("button", { name: "Send to Kitchen" });
      if (await send.isEnabled({ timeout: 2_000 }).catch(() => false)) await send.click(quick);
    },
    "punch an order and take payment straight away": async () => {
      await addSomeItems();
      await chooseTableOrTakeaway();
      const takePayment = page.getByRole("button", { name: "Take Payment" });
      if (await takePayment.isEnabled({ timeout: 2_000 }).catch(() => false)) {
        await takePayment.click(quick);
        await pay().catch(closeAnything);
      }
    },
    "pay an order from the queue": async () => {
      const row = await queueRow();
      const payment = row?.getByRole("button", { name: "Payment" });
      if (payment && (await payment.isVisible().catch(() => false))) {
        await payment.click(quick);
        await pay();
      }
    },
    "open something on a queued order and close it": async () => {
      const row = await queueRow();
      if (!row) return;
      const name = pick(["Bill", "Manage", "Ticket", "Reprint receipt", "Refund", "Void", "Cancel", "Add items"]);
      const button = row.getByRole("button", { name, exact: true });
      if (!(await button.isVisible().catch(() => false))) return;
      await button.click(quick);
      await page.waitForTimeout(800);
      if (name === "Add items") {
        await addSomeItems();
        const submit = page.getByRole("button", { name: /Add to order #|Send to Kitchen|Add items/ }).last();
        if (chance(0.6) && (await submit.isEnabled({ timeout: 2_000 }).catch(() => false))) await submit.click(quick).catch(() => {});
      }
      await closeAnything();
    },
    "open an occupied table": async () => {
      await page.getByRole("button", { name: /^(Select a table|Table )/ }).click(quick);
      const busy = page.getByRole("dialog").getByRole("button").filter({ hasText: /seats/ });
      const n = await busy.count();
      if (n) await busy.nth(Math.floor(rand() * n)).click(quick);
      await page.waitForTimeout(500);
      if (chance(0.4)) {
        const takePayment = page.getByRole("button", { name: "Take Payment" });
        if (await takePayment.isEnabled({ timeout: 2_000 }).catch(() => false)) {
          await takePayment.click(quick);
          await pay().catch(closeAnything);
        }
      }
      await closeAnything();
    },
    "search the menu": async () => {
      await page.getByRole("textbox", { name: "Search menu" }).fill(pick(["kebab", "dahi", "x", "", "chai"]));
    },
    "open the customer and discount pickers": async () => {
      await page.getByText("Add customer (optional)").click(quick).catch(() => {});
      await closeAnything();
      await page.getByText("Apply discount (optional)").click(quick).catch(() => {});
      await closeAnything();
    },
    "the internet drops, then comes back": async () => {
      offline = !offline;
      await page.context().setOffline(offline);
    },
    "the wifi stays up but nothing gets through": async () => {
      noInternet = !noInternet;
      if (noInternet) await page.route("**/api/**", (r) => r.abort("internetdisconnected"));
      else await page.unroute("**/api/**");
    },
    "reload the till": async () => {
      // Offline, only the service worker can bring the page back, and it only runs in a production
      // build (service-worker-registration.tsx). Without one the browser's own offline page is the
      // correct result, not the till's failure.
      if ((offline || noInternet) && !(await page.evaluate(() => !!navigator.serviceWorker?.controller))) return;
      await page.reload();
      await tillIsBack("a reload");
    },
    "go to the back office and come back": async () => {
      if (offline || noInternet) return;
      await page.getByRole("link", { name: /Back office/ }).click(quick);
      await page.waitForTimeout(800);
      await page.goto("/pos");
      await tillIsBack("coming back from the back office");
    },
  };

  await page.goto("/pos");
  await expect(page.getByText(/Online — all orders synced|unsynced/)).toBeVisible({ timeout: 30_000 });

  try {
    for (let i = 0; i < STEPS; i++) {
      const [name, run] = pick(Object.entries(tillActions));
      say(`${i + 1}. ${name}${offline ? " [offline]" : ""}${noInternet ? " [no internet]" : ""}`);
      try {
        await run();
      } catch (err) {
        // A button that isn't there this time, a dialog that closed first: the shift goes on.
        say(`   (skipped: ${String(err).split("\n")[0].slice(0, 100)})`);
        await closeAnything();
      }
      await page.waitForTimeout(300 + rand() * 700);
      await assertStanding(name);
    }
  } finally {
    traffic = false;
    await background;
    if (offline) await page.context().setOffline(false);
    if (noInternet) await page.unroute("**/api/**");
    await Promise.all([waiter.dispose(), kitchen.dispose(), owner.dispose(), anon.dispose()]);
    // A shift leaves dozens of open orders and occupied tables behind. Left there, they slowed the
    // kitchen board and the till's activity check for every spec after this one, and seven of them
    // timed out in a full run while passing on their own.
    await reclaimTables();
  }

  // Nothing went wrong unseen either: an exception the screen survived is still a bug.
  expect(browserErrors, "uncaught errors in the browser during the shift").toEqual([]);
});

/**
 * The till opening with no internet, from what the service worker saved — the case a reload during
 * an outage depends on. Only meaningful against a production build (E2E_PROD=1), the only place the
 * worker is registered; on the dev server it skips rather than pass for the wrong reason.
 */
test("offline, a reload brings the till back from the device", async ({ page }) => {
  await page.goto("/pos");
  await expect(page.getByText(/Online — all orders synced|unsynced/)).toBeVisible({ timeout: 30_000 });
  const controlled = await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!controlled, "No service worker controls the page (dev server). Run with E2E_PROD=1.");

  // The worker warms /pos for this build in the background; give it the moment it needs.
  await page.waitForTimeout(3_000);
  await page.context().setOffline(true);
  try {
    // With no saved copy this would be the browser's own offline error, or the worker's "This screen
    // hasn't been opened on this device yet" page.
    await page.reload();
    // The till, with its menu (from the device's own cache) there to sell from. Not the offline
    // banner: under Playwright's network emulation a reloaded page reports navigator.onLine as true.
    await expect(page.getByRole("textbox", { name: "Search menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("button.min-h-28").first()).toBeVisible();
    await expect(page.getByText(/hasn't been opened on this device/)).toHaveCount(0);
    await expect(page.getByText(/hit a problem/)).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
  }
});
