import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { OutageScene } from "@/components/marketing/outage-scene";
import { Capabilities } from "@/components/marketing/capabilities";
import { TaxScene } from "@/components/marketing/tax-scene";
import { Plans, Closing } from "@/components/marketing/plans-closing";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { BRAND_NAME, COMPANY_NAME } from "@/config/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} — the till that keeps selling when the internet stops`,
  description: `${BRAND_NAME} runs the counter, kitchen, stock, staff and delivery for restaurants in Pakistan — and keeps taking orders through an outage. By ${COMPANY_NAME}.`,
  openGraph: {
    title: `${BRAND_NAME} — the till that keeps selling when the internet stops`,
    description: `Restaurant software built in Pakistan, by ${COMPANY_NAME}. Works offline, prices Punjab PRA's split rates correctly, and runs one branch or six.`,
    type: "website",
  },
};

/**
 * The landing page.
 *
 * Structured as an argument rather than a feature list. The claim that matters is made in the hero,
 * performed in the outage scene, grounded in the tax scene, and only then broadened into everything
 * else the software covers — because a restaurant owner deciding in fifteen seconds is deciding on
 * the first of those, not the fourth.
 *
 * Two things stay true from the first version and are worth restating, since a showier page makes
 * both more tempting to abandon:
 *
 * No testimonials, logos, counts or ratings. There are no paying clients yet, and invented social
 * proof is the one claim on a landing page a prospect can actually check.
 *
 * No prices. Billing is per branch, per month, set per tenant — any number printed here would be
 * made up.
 *
 * Everything shown is real: the menu, the prices and the 16% / 8% tax rates are the seeded demo
 * tenant's, and the terminal is the product's own interface rendered live rather than a screenshot,
 * which is what lets the outage scene show the till working instead of asserting that it does.
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-[#08070f]">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <OutageScene />
        <Capabilities />
        <TaxScene />
        <Plans />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
