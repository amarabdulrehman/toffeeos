import type { Metadata } from "next";
import { displaySerif } from "@/components/marketing/fonts";
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
 * Designed as printed matter — warm paper, deep ink, a display serif, and the visual language of a
 * restaurant's own paperwork: dotted leader lines, hairline rules, monospaced figures, a torn edge
 * where the paper meets the dark section. The previous version was near-black with a violet radial
 * glow and a geometric sans, which is the default output of every AI site builder and read that way
 * however carefully it was built. The palette and composition here are a decision; that is the
 * whole difference.
 *
 * Structured as an argument, not a feature list: the claim is made in the hero, performed in the
 * outage scene, grounded in the tax scene, and only then broadened. An owner deciding in fifteen
 * seconds is deciding on the first of those.
 *
 * Everything shown is real. The menu, the prices and the 16% / 8% rates are the seeded demo
 * tenant's, and the terminal is the product's own interface — light-bodied with navy chrome,
 * matching what the software actually looks like rather than what suited the page.
 *
 * Still no testimonials, logos or counts: there are no paying clients yet, and invented social
 * proof is the one claim a prospect can check. Still no prices: billing is per branch, per month,
 * set per tenant.
 */
export default function Home() {
  return (
    <div className={`tos-landing ${displaySerif.variable} flex flex-1 flex-col`}>
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
