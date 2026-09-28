import { test, expect, type Page } from "@playwright/test";
import { authFile, TENANT_SLUG } from "./fixtures/test-data";

/**
 * Every screen, at every size staff actually hold.
 *
 * This product runs on a counter tablet, a manager's phone and an office laptop, often all three
 * in the same restaurant on the same day. Horizontal overflow is the specific failure that makes a
 * screen unusable rather than merely ugly: a table that pushes the page sideways puts the Save
 * button off the edge, and on a touch device there is no scrollbar to reveal it.
 *
 * Checks the document, not individual elements. A table that scrolls *inside its own container* is
 * correct and expected — the bug is the page itself scrolling sideways.
 */

/**
 * Measures sideways overflow on whatever is actually scrolling.
 *
 * The document is not the only thing that can scroll sideways: the app shell puts `overflow-auto`
 * on <main>, so a too-wide card makes *main* scroll while documentElement stays exactly 100% wide —
 * a page can be visibly broken while the document looks perfect. An earlier version of this test
 * measured only the document and passed a deliberately sabotaged 1400px card without noticing.
 */
async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const main = document.querySelector("main");
    const host =
      de.scrollWidth > de.clientWidth + 1
        ? de
        : main && main.scrollWidth > main.clientWidth + 1
          ? main
          : null;
    if (!host) return null;

    // Name the widest offender, so a failure says what to fix rather than just that something is
    // wrong.
    let culprit = "(unknown)";
    let worst = host.clientWidth;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || r.width === 0) continue;
      if (r.right > worst) {
        worst = r.right;
        culprit = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)}`;
      }
    }
    return { scrollWidth: host.scrollWidth, clientWidth: host.clientWidth, culprit };
  });
}

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "laptop", width: 1366, height: 768 },
] as const;

const SCREENS = [
  "/app/dashboard",
  "/app/menu",
  "/app/tables",
  "/app/inventory",
  "/app/reports",
  "/app/staff",
  "/app/customers",
  "/app/expenses",
  "/app/hr",
  "/app/delivery",
  "/app/branches",
  "/app/cash-drawer",
  "/app/sales",
  "/app/billing",
  "/app/online-ordering",
  "/app/whatsapp",
  "/app/sync-conflicts",
  "/pos",
  "/kds",
];

test.describe("Responsive layout", () => {
  test.use({ storageState: authFile("owner") });

  for (const size of SIZES) {
    test(`no screen scrolls sideways at ${size.name} (${size.width}px)`, async ({ page }) => {
      // Seventeen navigations against a cross-region database; the default 60s is not close.
      test.setTimeout(6 * 60_000);
      await page.setViewportSize({ width: size.width, height: size.height });

      const broken: { screen: string; scrollWidth: number; clientWidth: number; culprit: string }[] = [];

      for (const screen of SCREENS) {
        await page.goto(screen, { waitUntil: "domcontentloaded" });
        // Not networkidle: several screens hold an open realtime subscription, so the network is
        // never idle and the wait would burn the whole budget. Wait for the loading boundary to
        // give way to real content instead.
        await page
          .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 20_000 })
          .catch(() => {});
        await page.waitForTimeout(300);

        const result = await measureOverflow(page);

        if (result) broken.push({ screen, ...result });
      }

      expect(
        broken,
        `screens scrolling sideways at ${size.width}px:\n` +
          broken.map((b) => `  ${b.screen}  ${b.scrollWidth}>${b.clientWidth}  widest: ${b.culprit}`).join("\n")
      ).toEqual([]);
    });
  }
});

test.describe("Back-office navigation on a phone", () => {
  test.use({ storageState: authFile("owner"), viewport: { width: 390, height: 844 } });

  test("the sidebar gives way to a drawer that opens, navigates, and closes itself", async ({ page }) => {
    await page.goto("/app/dashboard");

    // The 240px sidebar must be out of the flow entirely — at 390px it was leaving 150px of
    // content, which is what made every back-office screen unusable on a phone.
    await expect(page.locator("aside")).toBeHidden();

    const main = page.locator("main");
    const width = await main.evaluate((el) => el.clientWidth);
    expect(width, "the content area should have the screen, not what a sidebar left over").toBeGreaterThan(330);

    // Open it.
    const menu = page.getByRole("button", { name: "Open menu" });
    await expect(menu).toBeVisible();
    await menu.click();

    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    // The same nav lives in here as in the sidebar — not a reduced copy.
    await expect(drawer.getByRole("link", { name: /reports/i })).toBeVisible();

    // Tapping a link navigates and takes the drawer with it.
    await drawer.getByRole("link", { name: /reports/i }).click();
    await expect(page).toHaveURL(/\/app\/reports/);
    await expect(drawer).toBeHidden();
  });

  test("escape closes the drawer", async ({ page }) => {
    await page.goto("/app/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});

/**
 * The public pages — the landing page above all.
 *
 * Nothing covered these. Every screen in the list above sits behind a login, so the pages a
 * *stranger* sees — the landing page they judge the product on, the signup form, and the ordering
 * page a guest opens from a QR code at their table — had no size coverage of any kind. The
 * ordering page is the most phone-critical page in the whole product: it is only ever opened on a
 * phone, by someone who has not chosen to be there and will not persevere.
 *
 * Anonymous on purpose. These render for people who have no session, so testing them with an
 * owner's cookie would be testing a different page than the one that matters.
 */
const PUBLIC_SCREENS = ["/", "/pricing", "/login", "/signup", "/privacy", "/terms", `/order/${TENANT_SLUG}`];

test.describe("Public pages", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const size of SIZES) {
    test(`no public page scrolls sideways at ${size.name} (${size.width}px)`, async ({ page }) => {
      test.setTimeout(4 * 60_000);
      await page.setViewportSize({ width: size.width, height: size.height });

      const broken: { screen: string; scrollWidth: number; clientWidth: number; culprit: string }[] = [];

      for (const screen of PUBLIC_SCREENS) {
        // Assert the page actually rendered. A 404 or a redirect to login never overflows, so a
        // typo'd route in the list above would sail through this test having measured nothing.
        const response = await page.goto(screen, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${screen} did not render`).toBeLessThan(400);
        expect(new URL(page.url()).pathname, `${screen} redirected away`).toBe(screen);
        await page
          .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 20_000 })
          .catch(() => {});
        // The landing page animates in and pins sections as they enter; settle before measuring, or
        // a mid-flight transform reads as overflow that is not really there.
        await page.waitForTimeout(700);

        const result = await measureOverflow(page);
        if (result) broken.push({ screen, ...result });
      }

      expect(
        broken,
        [
          `public pages scrolling sideways at ${size.width}px:`,
          ...broken.map((b) => `  ${b.screen}  ${b.scrollWidth}>${b.clientWidth}  widest: ${b.culprit}`),
        ].join("\n")
      ).toEqual([]);
    });
  }
});
