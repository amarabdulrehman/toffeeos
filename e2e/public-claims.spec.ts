import { test, expect } from "@playwright/test";
import { FEATURES } from "../src/lib/marketing/features";

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
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

test("the homepage claims nothing ToffeeOS doesn't do", async ({ request }) => {
  const text = visibleText(await (await request.get("/")).text());
  expect(text.match(FORBIDDEN)?.[0] ?? null, "names something ToffeeOS doesn't do").toBeNull();
  expect(text, "riders aren't tracked on a map").not.toMatch(/riders?[^.]{0,40}tracked/i);
  expect(text, "there's no floor plan to arrange tables on").not.toMatch(/floor ?plan/i);
  // Nothing said about competitors' software that their own sites contradict or we can't show.
  expect(text).not.toMatch(/on most systems|written somewhere else/i);
  // No handoff code reaches a customer, and nothing in the app can mark a table reserved.
  expect(text, "claims a delivery code or reserved tables").not.toMatch(/photo or a code|reserved or occupied/i);
  // Still says what it does do.
  expect(text).toContain("every delivery proved with a photo");
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

/**
 * The pricing page. Pricing is quote-based by the owner's decision, so no figure may appear on it —
 * not in the text, and not in the structured data. What each plan includes comes from the same
 * source as the cards above (src/lib/marketing/plans.ts) and is pinned here the same way.
 */
const PRICE = /(Rs\.?|PKR|USD|US\$|\$)\s?\d|\d[\d,]*\s?(rupees|\/-)|\d[\d,.]*\s?(\/|per )\s?(month|mo|branch|user|seat)\b/i;

const PRICING_GROUPS = {
  "On every plan": [
    "Point of sale & offline mode",
    "Kitchen display",
    "Tables, grouped by floor",
    "Menu, variants & modifiers",
    "Sales & staff reports",
    "Staff, roles & permissions",
  ],
  "Growth and Complete add": ["Inventory", "Recipe & Costing", "CRM", "Expenses", "Full Report Suite"],
  "Complete adds": ["Delivery & Rider Management", "Online Ordering", "Payroll & HR"],
};

/**
 * Claims the site must never make, on any public page or in anything a search engine or an
 * assistant reads from one: the visible text, the title and descriptions, the structured data, and
 * /llms.txt.
 *
 * - WhatsApp messaging: it waits on Meta's approval, and no message has ever been delivered.
 * - Live or real-time rider tracking: there's no map, only proof of each delivery.
 * - Reservations or table booking: a table is free or occupied, nothing else.
 * - Dish photos: nothing in the app can set one.
 * - Allergens: not built.
 * - Payments offline that aren't cash: offline, the payment dialog only has the cash-rate total.
 *   A card or wallet payment is taxed at its own rate, and the till prices that through the server.
 *
 * A page may state one of these as a limit, but only word for word from STATED_LIMITS, so each new
 * one is a decision made here rather than a gap in a pattern.
 */
const PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/features",
  ...FEATURES.map((f) => `/features/${f.slug}`),
  "/privacy",
  "/terms",
  "/signup",
  "/login",
  "/llms.txt",
];

const STATED_LIMITS = ["There are no reservations: a table is free or occupied.", "There's no live map of where riders are."];

/**
 * WhatsApp in the terms and the privacy policy, word for word, left for the owner to decide on
 * 29 September 2026 rather than rewritten as copy: changing a legal document is a legal decision.
 * The terms still list "optional WhatsApp messaging" as a feature, and the privacy policy describes
 * customers ordering "via … WhatsApp", which has never existed. Delete these once the documents
 * are revised: any other mention of WhatsApp on either page already fails.
 */
const LEGAL_WHATSAPP_PENDING: Record<string, string[]> = {
  "/privacy": [
    "(e.g. via online/QR ordering or WhatsApp)",
    "From End Customers (via online ordering or WhatsApp), collected on behalf of the Tenant:",
    "Order history and content of order-related WhatsApp messages (e.g. order confirmations, thank-you messages, delivery updates), only if the Tenant has enabled that feature.",
    "Provide the features a Tenant enables (order processing, KDS, reporting, payroll calculations, WhatsApp notifications);",
    "Send operational communications (e.g. password reset emails, order-related WhatsApp messages a Tenant has configured);",
    "Meta / WhatsApp Business Platform",
    "Delivering WhatsApp messages, where a Tenant enables this feature",
  ],
  "/terms": [
    "and optional WhatsApp messaging.",
    "(e.g. phone numbers for online ordering or WhatsApp notifications)",
    "(including via WhatsApp)",
  ],
};

// The first that matches is reported, so "real-time rider tracking" is named as that, not as "live".
const BANNED: { claim: string; pattern: RegExp }[] = [
  { claim: "WhatsApp messaging", pattern: /whats\s?app/i },
  { claim: "real-time rider tracking", pattern: /\breal[- ]?time\b[^.]{0,40}\b(track\w*|maps?|locations?|riders?)\b/i },
  {
    claim: "live rider tracking",
    pattern: /\blive\b[^.]{0,30}\b(track\w*|maps?|locations?)\b|\briders?\b[^.]{0,40}\btrack\w*|\btrack\w*\b[^.]{0,40}\briders?\b/i,
  },
  {
    claim: "reservations or table booking",
    pattern:
      /\breservations?\b|\breserv(e|ed|ing)\b[^.]{0,25}\btables?\b|\btables?\b[^.]{0,25}\breserv(e|ed|ing)\b|\bbook(s|ed|ing|ings)?\b[^.]{0,25}\btables?\b|\btables?[- ]book\w*/i,
  },
  {
    claim: "dish photos",
    pattern: /\b(dish(es)?|menu|food)\b[^.]{0,30}\b(photo|picture|image)s?\b|\b(photo|picture|image)s?\b[^.]{0,30}\b(dish(es)?|menu|food)\b/i,
  },
  { claim: "allergens", pattern: /\ballerg\w*/i },
];

// Offline payments: in a clause about the connection being down, every mention of paying must be
// limited to cash ("cash payments", "payment in cash"), or be card or wallet payments said to wait.
const OFFLINE =
  /\boffline\b|\boutages?\b|\binternet (drops|stops|goes down|is down)\b|\bconnection (drops|goes down|returns|is back|comes back)\b|\bno connection\b|\bline (drops|is back)\b|\bback online\b/i;
const PAYING = /\b(payments?|pay|paid|billing)\b/gi;
const NON_CASH = /\b(cards?|wallets?|non-cash|jazzcash|easypaisa)\b/i;
const WAITS = /\bwaits?\b|\bneeds? the connection\b|\b(once|when|until) the connection (is back|returns|comes back)\b|\bback online\b/i;

function paymentNotLimitedToCash(clause: string): string | null {
  if (!OFFLINE.test(clause)) return null;
  for (const m of clause.matchAll(PAYING)) {
    const before = clause.slice(0, m.index).trimEnd().split(/\s+/).slice(-3).join(" ");
    const after = clause.slice(m.index! + m[0].length).trimStart().split(/\s+/).slice(0, 3).join(" ");
    if (/\bcash\b/i.test(before) || /\bcash\b/i.test(after)) continue;
    if (NON_CASH.test(before) && WAITS.test(clause)) continue;
    return m[0];
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

// Block elements end a run of text, so a menu link or a heading never runs into the next sentence.
const BLOCK_TAG =
  /<\/?(p|h[1-6]|li|ul|ol|div|section|article|header|footer|nav|main|aside|table|tr|td|th|dl|dt|dd|blockquote|figure|figcaption|title|button|a|br|summary|details|form|label)\b[^>]*>/gi;

/** Every piece of text a reader, a search result or an assistant gets from a page. */
function readableText(html: string): string[] {
  const pieces: string[] = [];
  for (const [, content] of html.matchAll(/<meta (?:name|property)="(?:description|og:[\w:]+|twitter:[\w:]+)" content="([^"]*)"/g)) {
    pieces.push(decode(content));
  }
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (v: unknown): void => {
      if (typeof v === "string") pieces.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(json));
  }
  const body = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(BLOCK_TAG, "\n")
    .replace(/<[^>]+>/g, " ");
  pieces.push(...decode(body).split("\n"));
  return pieces.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

test("no public page claims WhatsApp, rider tracking, reservations, dish photos, allergens, or non-cash payments offline", async ({
  request,
}) => {
  const found = new Set<string>();
  for (const path of PUBLIC_PATHS) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const body = await res.text();
    for (let piece of path.endsWith(".txt") ? body.split("\n") : readableText(body)) {
      for (const allowed of [...STATED_LIMITS, ...(LEGAL_WHATSAPP_PENDING[path] ?? [])]) piece = piece.split(allowed).join(" ");
      // A full stop ends a sentence, except in "e.g." and "i.e.".
      for (const sentence of piece.split(/(?<=[.!?])(?<!\be\.g\.)(?<!\bi\.e\.)\s+/)) {
        const banned = BANNED.find((b) => b.pattern.test(sentence));
        if (banned) found.add(`${path} claims ${banned.claim} ("${sentence.match(banned.pattern)![0]}") in: "${sentence.trim()}"`);
        for (const clause of sentence.split(/\s+—\s+|;\s+/)) {
          const word = paymentNotLimitedToCash(clause);
          if (word) found.add(`${path} claims payments work offline, not just cash ("${word}") in: "${clause.trim()}"`);
        }
      }
    }
  }
  expect([...found], "claims ToffeeOS can't back up").toEqual([]);
});

test.describe("Pricing page", () => {
  test("states no price anywhere, and nothing ToffeeOS doesn't do", async ({ request }) => {
    const html = await (await request.get("/pricing")).text();
    const text = visibleText(html);
    expect(text.match(PRICE)?.[0] ?? null, "a price on a quote-only page").toBeNull();
    expect(html, "a price in the structured data").not.toMatch(/"(offers|price|priceCurrency|priceSpecification|lowPrice|highPrice)"/);
    expect(text.match(FORBIDDEN)?.[0] ?? null, "names something ToffeeOS doesn't do").toBeNull();
    expect(text).not.toMatch(/most (start|choose|popular)/i);
    expect(text, "claims a delivery code or reserved tables").not.toMatch(/photo or a code|reserved or occupied/i);
    // The model, stated plainly: per branch, not per seat, quoted.
    expect(text).toContain("priced per branch, per month");
    expect(text).toContain("Nothing is charged per user or per device");
    expect(text).toContain("14 days on the Starter plan");
  });

  test("is its own page, and lists what each plan includes exactly", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveTitle("Pricing — Restaurant POS Priced per Branch | ToffeeOS");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://toffeeos.com/pricing");
    await expect(page.locator("h1")).toHaveCount(1);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description!.length, "fits in a search result").toBeLessThanOrEqual(160);

    for (const [heading, lines] of Object.entries(PRICING_GROUPS)) {
      const group = page.locator(`[data-plan-group="${heading}"]`);
      await expect(group.locator("li p:first-child"), heading).toHaveText(lines);
    }
    await expect(page.locator("[data-plan-branches]")).toHaveText(["One branch", "Up to 3 branches", "Any number of branches"]);
    // Every quote link reaches the company, with the plan named where one is chosen.
    const hrefs = await page.locator('a[href^="mailto:"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const plan of ["Starter", "Growth", "Complete"]) {
      expect(hrefs.some((h) => decodeURIComponent(h).includes(`${plan} plan enquiry`)), `a quote link for ${plan}`).toBe(true);
    }
  });

  test("the homepage and the footer lead to it", async ({ request }) => {
    const home = await (await request.get("/")).text();
    expect(home).toContain('href="/pricing"');
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://toffeeos.com/pricing</loc>");
  });
});
