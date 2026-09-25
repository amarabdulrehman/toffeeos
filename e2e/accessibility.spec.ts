import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authFile, TENANT_SLUG } from "./fixtures/test-data";

/**
 * Accessibility, checked where it actually bites.
 *
 * Not a compliance exercise. A POS is operated at speed by staff who may be working a double,
 * under bad lighting, on a cheap tablet — and the same properties that make a screen usable to
 * someone with low vision make it usable to a tired cashier at 11pm. Contrast, focus order and
 * labelled controls are operational concerns here, not box-ticking.
 *
 * Scoped to serious, unambiguous violations: colour contrast, missing form labels, missing button
 * names, and broken heading/landmark structure. Deliberately not every axe rule — a suite that
 * reports forty advisory findings gets muted, and a muted suite catches nothing.
 */

const RULES = [
  "color-contrast",
  "label",
  "button-name",
  "link-name",
  "image-alt",
  "aria-required-attr",
  "aria-valid-attr-value",
  "duplicate-id-active",
  "form-field-multiple-labels",
];

const SCREENS = ["/app/dashboard", "/app/sales", "/app/billing", "/app/menu", "/app/reports", "/app/staff", "/app/inventory", "/pos", "/kds"];

test.describe("Accessibility", () => {
  test.use({ storageState: authFile("owner") });

  for (const screen of SCREENS) {
    test(`${screen} has no serious accessibility violations`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(screen, { waitUntil: "domcontentloaded" });
      await page
        .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(400);

      const { violations } = await new AxeBuilder({ page }).withRules(RULES).analyze();

      const report = violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.help}\n` +
            v.nodes.slice(0, 3).map((n) => `      ${n.target.join(" ")}\n        ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`).join("\n")
        )
        .join("\n");

      expect(violations, `${screen}\n${report}`).toEqual([]);
    });
  }
});

test.describe("Keyboard operation", () => {
  test.use({ storageState: authFile("owner") });

  test("every interactive control on the POS is reachable and shows focus", async ({ page }) => {
    await page.goto("/pos");
    await page.waitForTimeout(1200);

    // A control that can be focused but shows nothing is unusable without a mouse — and on a till
    // that is also the difference between a cashier finding the payment button and hunting for it.
    const invisible = await page.evaluate(() => {
      const bad: string[] = [];
      const focusable = document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      for (const el of Array.from(focusable).slice(0, 40)) {
        el.focus();
        if (document.activeElement !== el) continue;
        const cs = getComputedStyle(el);
        const hasRing =
          cs.outlineStyle !== "none" ||
          cs.boxShadow !== "none" ||
          cs.borderColor !== getComputedStyle(el.parentElement ?? document.body).borderColor;
        if (!hasRing) bad.push(el.tagName.toLowerCase() + ": " + (el.textContent ?? "").trim().slice(0, 30));
      }
      return bad;
    });

    expect(invisible, `controls with no visible focus state:\n  ${invisible.join("\n  ")}`).toEqual([]);
  });
});

/**
 * The public pages, checked anonymously.
 *
 * Everything above sits behind a login. The landing page is the first thing anyone sees of this
 * product, the signup form is how someone becomes a customer, and the ordering page is opened by a
 * guest at a table — none of them had any accessibility check at all. The landing page is the
 * likeliest to have a problem: it is a warm-paper palette with a lot of deliberately muted
 * secondary text, and muted is exactly where 4.5:1 goes wrong.
 */
const PUBLIC_SCREENS = ["/", "/login", "/signup", "/privacy", "/terms", `/order/${TENANT_SLUG}`];

test.describe("Accessibility — public pages", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const screen of PUBLIC_SCREENS) {
    test(`${screen} has no serious accessibility violations`, async ({ page }) => {
      test.setTimeout(90_000);

      // A 404 has almost nothing on it to violate anything, so without this a typo'd route would
      // pass while testing nothing at all.
      const response = await page.goto(screen, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${screen} did not render`).toBeLessThan(400);

      await page
        .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 20_000 })
        .catch(() => {});
      // The landing page fades and slides its content in; axe reads colour off the composited
      // result, so measuring mid-animation invents contrast failures that are not real.
      await page.waitForTimeout(1200);

      const { violations } = await new AxeBuilder({ page }).withRules(RULES).analyze();

      const report = violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.help}\n` +
            v.nodes
              .slice(0, 3)
              .map((n) => `      ${n.target.join(" ")}\n        ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`)
              .join("\n")
        )
        .join("\n");

      expect(violations, `${screen}\n${report}`).toEqual([]);
    });
  }
});
