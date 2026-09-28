import { test, expect } from "@playwright/test";

/**
 * The public site claims only what ToffeeOS does.
 *
 * PRA e-IMS integration, FBR digital invoicing, Foodpanda integration and Urdu don't exist, and
 * WhatsApp messaging waits on Meta's approval — no message has ever been delivered. The homepage
 * named WhatsApp three times and said riders were "tracked" (there is no map, only proof of each
 * delivery). The plan cards promised a "floor plan" (tables are grouped by floor; there is no map
 * of the room) and listed "Multi-branch" under Starter, which allows one branch. This fails if any
 * of that comes back.
 */

const FORBIDDEN = /e-?IMS|\bFBR\b|foodpanda|\burdu\b|whatsapp/i;

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

test("the homepage claims nothing ToffeeOS doesn't do", async ({ request }) => {
  const text = visibleText(await (await request.get("/")).text());
  expect(text.match(FORBIDDEN)?.[0] ?? null, "names something ToffeeOS doesn't do").toBeNull();
  expect(text, "riders aren't tracked on a map").not.toMatch(/riders?[^.]{0,40}tracked/i);
  expect(text, "there's no floor plan to arrange tables on").not.toMatch(/floor ?plan/i);
  // Nothing said about competitors' software that their own sites contradict or we can't show.
  expect(text).not.toMatch(/on most systems|written somewhere else/i);
  // Still says what it does do.
  expect(text).toContain("every delivery proved with a photo or a code");
});

/**
 * The plan cards, pinned exactly.
 *
 * The plans section has been the riskiest copy on the site: WhatsApp, "floor plan" and a
 * multi-branch Starter were all overclaims found there. The cards are built from
 * GATEABLE_MODULES and TIER_MAX_BRANCHES, so a change to tiers or modules changes what they
 * promise without anyone editing the page. This test lists every line on purpose. When it fails,
 * read the cards against the code before updating it — don't just paste in the new output.
 */
const PLAN_CARDS = [
  {
    name: "Starter",
    lines: [
      "One branch",
      "Point of sale & offline mode",
      "Kitchen display",
      "Tables, grouped by floor",
      "Menu, variants & modifiers",
      "Sales & staff reports",
      "Staff, roles & permissions",
    ],
  },
  { name: "Growth", lines: ["Up to 3 branches", "Inventory", "Recipe & Costing", "CRM", "Expenses", "Full Report Suite"] },
  {
    name: "Complete",
    lines: [
      "Any number of branches",
      "Inventory",
      "Recipe & Costing",
      "CRM",
      "Expenses",
      "Full Report Suite",
      "Delivery & Rider Management",
      "Online Ordering",
      "Payroll & HR",
    ],
  },
];

test("each plan card promises exactly what that plan unlocks, and nothing about customers", async ({ page }) => {
  await page.goto("/");
  const plans = page.locator("#plans");
  await expect(plans.locator("h3")).toHaveText(PLAN_CARDS.map((c) => c.name));
  const lists = plans.locator("ul");
  await expect(lists).toHaveCount(PLAN_CARDS.length);
  for (const [i, card] of PLAN_CARDS.entries()) {
    await expect(lists.nth(i).locator("li"), `${card.name}'s card`).toHaveText(card.lines);
  }
  // No claim about what customers choose: there are none to count yet.
  await expect(plans).not.toContainText(/most (start|choose|popular)/i);
});
