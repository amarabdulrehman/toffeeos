import { BRAND_NAME, COMPANY_EMAIL } from "@/config/brand";
import { GATEABLE_MODULES, TIER_LABEL, TIER_MAX_BRANCHES, TIER_ORDER, tierMeets, type GateableModule, type TierKey } from "@/lib/tiers";

/**
 * What each plan includes, as the public site states it: the homepage's plan cards and the
 * pricing page both read from here.
 *
 * Every overclaim found on the site so far was in the plans list — WhatsApp, a "floor plan", and
 * "Multi-branch" under a one-branch Starter — so this is kept to one place, built from what the app
 * enforces (GATEABLE_MODULES and TIER_MAX_BRANCHES in src/lib/tiers.ts), and pinned line by line in
 * e2e/public-claims.spec.ts. When tiers or modules change, read what this says against the code.
 *
 * No prices: billing is per branch, per month and set per tenant (Subscription's
 * customMonthlyPricePaisa overrides the plan rate), so there is no public figure that wouldn't be
 * invented.
 */

export interface PlanLine {
  label: string;
  /** One sentence for the pricing page, checked against the code. */
  detail: string;
}

/** On every plan: nothing in these areas is gated (see MODULE_MIN_TIER in src/lib/tiers.ts). */
export const CORE_LINES: PlanLine[] = [
  {
    label: "Point of sale & offline mode",
    detail:
      "Dine-in, takeaway and delivery on one screen, a cash drawer for each business day, and orders and payments that keep going when the internet drops.",
  },
  { label: "Kitchen display", detail: "Every order on a kitchen screen with a running timer, or on printed kitchen tickets if you prefer." },
  // "Grouped by floor", not "floor plan": tables are listed under their floor, with no map of the
  // room (RestaurantTable.posX/posY exist in the schema but nothing reads or writes them).
  { label: "Tables, grouped by floor", detail: "Every table's status at a glance: free or occupied." },
  { label: "Menu, variants & modifiers", detail: "Sizes and add-ons, with each branch's own prices and availability." },
  { label: "Sales & staff reports", detail: "Daily sales, printable closing summaries, staff performance and CSV export." },
  { label: "Staff, roles & permissions", detail: "Your own roles, with a separate permission for each action." },
];

/**
 * Modules the plans don't advertise, though a tier unlocks them in the app. WhatsApp messaging
 * waits on Meta's approval and has never delivered a message; it goes back on the site the day one
 * is delivered.
 */
const NOT_ADVERTISED = new Set(["whatsapp"]);

const MODULE_DETAIL: Record<string, string> = {
  inventory: "Stock per storeroom, suppliers, purchase orders, transfers between branches and low-stock alerts.",
  recipe: "Recipes that take ingredients out of stock on every paid order, and the cost and margin of each dish.",
  crm: "Customer profiles and loyalty points.",
  finance: "Expenses by category, and profit and loss.",
  reports: "Discount and void audit, cancellations and inventory valuation.",
  delivery: "Riders assigned to orders, a rider app, every delivery proved with a photo, and rider performance.",
  online: "Your own ordering site and QR ordering at the table, with no per-order fee.",
  hr: "Employee records, shifts, attendance, payroll and payslips.",
};

/** Every module the site advertises, in the order the app lists them. */
export function advertisedModules(): (GateableModule & { detail: string })[] {
  return GATEABLE_MODULES.filter((m) => !NOT_ADVERTISED.has(m.key)).map((m) => {
    const detail = MODULE_DETAIL[m.key];
    // A new module must be described before it's advertised. The pricing page is static, so this
    // fails the build (and the old page stays live) rather than printing a blank row.
    if (!detail) throw new Error(`No public description for the "${m.key}" module in src/lib/marketing/plans.ts.`);
    return { ...m, detail };
  });
}

/** The modules a tier adds on top of the core, by label. */
export function modulesFor(tier: TierKey): string[] {
  return advertisedModules()
    .filter((m) => tierMeets(tier, m.minTier))
    .map((m) => m.label);
}

/** The lowest plan that includes every one of these modules (keys of GATEABLE_MODULES) and allows
 * at least `branches` branches (TIER_MAX_BRANCHES, the limit the app enforces). */
export function minTierFor(moduleKeys: string[], branches = 1): TierKey {
  let tier: TierKey = "starter";
  for (const key of moduleKeys) {
    const m = GATEABLE_MODULES.find((g) => g.key === key);
    // A static page: an unknown key fails the build, and the page already live stays up.
    if (!m) throw new Error(`Unknown module "${key}": not in GATEABLE_MODULES (src/lib/tiers.ts).`);
    if (!tierMeets(tier, m.minTier)) tier = m.minTier;
  }
  if (branches > 1) {
    const fits = TIER_ORDER.find((t) => {
      const max = TIER_MAX_BRANCHES[t];
      return max === null || max >= branches;
    });
    if (!fits) throw new Error(`No plan allows ${branches} branches.`);
    if (!tierMeets(tier, fits)) tier = fits;
  }
  return tier;
}

/** Which plans include a feature that needs these modules (and branches), as a sentence: "On every
 * plan", or "On the Growth and Complete plans". Worked out from the tiers, never typed into the copy. */
export function plansSentence(moduleKeys: string[], branches = 1): string {
  const from = minTierFor(moduleKeys, branches);
  const names = TIER_ORDER.filter((t) => tierMeets(t, from)).map((t) => TIER_LABEL[t]);
  if (names.length === TIER_ORDER.length) return "On every plan";
  if (names.length === 1) return `On the ${names[0]} plan`;
  return `On the ${names.slice(0, -1).join(", ")} and ${names.at(-1)} plans`;
}

/**
 * A page's plan line when parts of it need more than the page itself: "On every plan; some parts
 * need Complete". Without the second half, a page titled "Payroll & staff management" read "On
 * every plan" although payroll is on Complete only.
 */
export function plansSummary(moduleKeys: string[], branches = 1, sectionModuleKeys: string[][] = []): string {
  const base = minTierFor(moduleKeys, branches);
  const sentence = plansSentence(moduleKeys, branches);
  const higher = sectionModuleKeys.map((m) => minTierFor([...moduleKeys, ...m], branches)).filter((t) => t !== base);
  const lowest = TIER_ORDER.find((t) => higher.includes(t));
  if (!lowest) return sentence;
  const names = TIER_ORDER.filter((t) => tierMeets(t, lowest)).map((t) => TIER_LABEL[t]);
  return `${sentence}; some parts need ${names.join(" or ")}`;
}

/** The branch count the app enforces for a tier, as the plans state it. */
export function branchesLine(tier: TierKey): string {
  const max = TIER_MAX_BRANCHES[tier];
  if (max === null) return "Any number of branches";
  return max === 1 ? "One branch" : `Up to ${max} branches`;
}

export const PLAN_PITCH: Record<TierKey, string> = {
  starter: "One counter, running properly.",
  growth: "Watching stock and margins, not just sales.",
  complete: "Delivery, online orders and payroll too.",
};

/** A quote request by email, with the plan (when one is chosen) in the subject and the questions a
 * quote needs already in the body. */
export function quoteHref(tier?: TierKey): string {
  const subject = tier ? `${BRAND_NAME} — ${TIER_LABEL[tier]} plan enquiry` : `${BRAND_NAME} — pricing enquiry`;
  const body = [
    "Restaurant name:",
    "City:",
    "Number of branches:",
    `Plan: ${tier ? TIER_LABEL[tier] : "Starter, Growth, Complete, or not sure yet"}`,
    "",
  ].join("\n");
  return `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
