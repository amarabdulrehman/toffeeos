import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Breadcrumbs, MarketingShell } from "@/components/marketing/marketing-shell";
import { breadcrumbLd, faqLd, JsonLd } from "@/components/marketing/json-ld";
import { advertisedModules, branchesLine, CORE_LINES, PLAN_PITCH, quoteHref } from "@/lib/marketing/plans";
import { BRAND_NAME, COMPANY_EMAIL } from "@/config/brand";
import { TIER_LABEL, TIER_ORDER } from "@/lib/tiers";

/**
 * /pricing — how ToffeeOS is priced, without a price.
 *
 * Pricing is quote-based by the owner's decision: billing is per branch, per month and set per
 * tenant (Subscription.customMonthlyPricePaisa), so there is no public figure. The page explains
 * the model, says what each plan includes and ends in a quote request. No price anywhere on it, in
 * the structured data included; e2e/public-claims.spec.ts fails if one appears.
 *
 * Every statement was checked against the code. What each plan includes comes from
 * src/lib/marketing/plans.ts, the same source as the homepage's plan cards. The trial is 14 days on
 * Starter (src/server/tenant-signup.ts). A plan change keeps the account's data but can't take a
 * restaurant below its active branch count (changeTenantTier in src/server/platform.ts).
 */

const TITLE = `Pricing — Restaurant POS Priced per Branch | ${BRAND_NAME}`;
const DESCRIPTION = `${BRAND_NAME} is priced per branch, per month, with no charge per user or device. See what Starter, Growth and Complete include, and ask for a quote.`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", url: "/pricing", siteName: BRAND_NAME },
};

const TRAIL = [
  { name: "Home", path: "/" },
  { name: "Pricing", path: "/pricing" },
];

const BASIS = [
  {
    term: "Per branch",
    text: "A branch is one location, with its own tables, staff, stock, tax rates and business day. Two locations are two branches.",
  },
  {
    term: "Not per seat",
    text: `Add every cashier, waiter, manager, kitchen screen and rider the branch needs. ${BRAND_NAME} doesn't count users or devices, so none of them changes the price.`,
  },
  {
    term: "A monthly price, quoted",
    text: "Your monthly price is worked out from how many branches you run and which plan you're on.",
  },
];

const FAQS = [
  {
    q: "Is there a charge per user or per device?",
    a: "No. The price is per branch. Add as many cashiers, waiters, managers, kitchen screens and riders as you need.",
  },
  {
    q: "What counts as a branch?",
    a: "One location, with its own tables, staff, stock, tax rates and business day. A restaurant with two locations has two branches.",
  },
  {
    q: "Why aren't prices published?",
    a: "Because each price is worked out for the restaurant, from how many branches it runs and which plan it needs. Ask for a quote and we'll send you a figure.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes: 14 days on the Starter plan, from the sign-up page, and no card is asked for. If you'd like to see Growth or Complete first, say so when you ask for a quote.",
  },
  {
    q: "Can I change plan later?",
    a: "Yes. Tell us and we move your account to the new plan; your menu, orders and reports stay as they are. Each plan's branch limit still applies: a plan can only be chosen if it allows as many branches as you run.",
  },
  {
    q: "Do online orders cost extra per order?",
    a: "No. Orders from your own ordering site, and from QR codes at the table, carry no per-order fee. Online ordering is part of the Complete plan.",
  },
  {
    q: "Do I need special hardware?",
    a: `No. ${BRAND_NAME} runs in a web browser on a tablet, phone or computer, and prints receipts and kitchen tickets on any receipt printer the device can print to.`,
  },
];

const eyebrow = "text-[11px] font-medium tracking-[0.16em] text-[color:var(--ink-3)] uppercase";
const h2 = "font-display text-[clamp(1.7rem,3.6vw,2.4rem)] leading-[1.05] tracking-[-0.015em] text-[color:var(--ink)]";

function Line({ label, detail }: { label: string; detail: string }) {
  return (
    <li className="flex gap-3 py-3.5">
      <Check className="mt-[5px] size-3.5 shrink-0 text-[color:var(--accent)]" strokeWidth={3} aria-hidden />
      <div>
        <p className="text-[14.5px] font-medium text-[color:var(--ink)]">{label}</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-[color:var(--ink-2)]">{detail}</p>
      </div>
    </li>
  );
}

export default function PricingPage() {
  const modules = advertisedModules();
  const groups = [
    { heading: "On every plan", lines: [...CORE_LINES, ...modules.filter((m) => m.minTier === "starter")] },
    { heading: "Growth and Complete add", lines: modules.filter((m) => m.minTier === "growth") },
    { heading: "Complete adds", lines: modules.filter((m) => m.minTier === "complete") },
  ];

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd(TRAIL)} />
      <JsonLd data={faqLd(FAQS)} />

      <Breadcrumbs trail={TRAIL} />

      <header className="mt-8 max-w-2xl">
        <p className="tos-folio">PRICING</p>
        <h1 className="font-display mt-5 text-[clamp(2.3rem,5.4vw,3.8rem)] leading-[1.0] tracking-[-0.018em] text-[color:var(--ink)]">
          Priced per branch, not per seat.
        </h1>
        <p className="mt-6 text-[16px] leading-[1.65] text-[color:var(--ink-2)]">
          {BRAND_NAME} is priced per branch, per month, on three plans: Starter, Growth and Complete. Nothing is charged
          per user or per device, and there is no fee on orders from your own ordering site. Prices are quoted rather
          than published: tell us how many branches you run and which plan fits, and we&apos;ll send you a figure.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <a
            href={quoteHref()}
            className="inline-flex h-11 items-center rounded-sm bg-[color:var(--ink)] px-6 text-[13px] font-semibold text-[color:var(--paper)] transition-colors hover:bg-[color:var(--accent)]"
          >
            Ask for a quote
          </a>
          <Link
            href="/signup"
            className="border-b border-[color:var(--rule)] pb-0.5 text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            Or start the 14-day free trial
          </Link>
        </div>
      </header>

      <section aria-labelledby="basis" className="mt-20 border-t border-[color:var(--rule)] pt-12">
        <h2 id="basis" className={h2}>
          How the price is worked out
        </h2>
        <dl className="mt-8 grid gap-8 sm:grid-cols-3">
          {BASIS.map((b) => (
            <div key={b.term}>
              <dt className="text-[14.5px] font-semibold text-[color:var(--ink)]">{b.term}</dt>
              <dd className="mt-2 text-[14px] leading-relaxed text-[color:var(--ink-2)]">{b.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="plans" className="mt-20 border-t border-[color:var(--rule)] pt-12">
        <h2 id="plans" className={h2}>
          The three plans
        </h2>
        <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-[color:var(--rule)] bg-[color:var(--rule)] md:grid-cols-3">
          {TIER_ORDER.map((tier) => (
            <div key={tier} className={`flex flex-col p-7 ${tier === "growth" ? "bg-white" : "bg-[color:var(--paper-2)]"}`}>
              <div className="flex items-baseline gap-3">
                <h3 className="font-display text-2xl text-[color:var(--ink)]">{TIER_LABEL[tier]}</h3>
                {tier === "growth" && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-violet-800 uppercase">
                    Recommended
                  </span>
                )}
              </div>
              <p className="mt-2.5 text-[14px] text-[color:var(--ink-2)]">{PLAN_PITCH[tier]}</p>
              <p className="mt-5 text-[14px] font-medium text-[color:var(--ink)]" data-plan-branches>
                {branchesLine(tier)}
              </p>
              <a
                href={quoteHref(tier)}
                className={`mt-6 inline-flex h-10 items-center justify-center rounded-sm text-[13px] font-semibold transition-colors ${
                  tier === "growth"
                    ? "bg-[color:var(--ink)] text-[color:var(--paper)] hover:bg-[color:var(--accent)]"
                    : "border border-[color:var(--rule)] text-[color:var(--ink)] hover:border-[color:var(--ink)]"
                }`}
              >
                Get a quote for {TIER_LABEL[tier]}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="includes" className="mt-20 border-t border-[color:var(--rule)] pt-12">
        <h2 id="includes" className={h2}>
          What each plan includes
        </h2>
        <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-[color:var(--ink-2)]">
          Each plan includes everything in the one before it, and allows more branches.
        </p>
        <div className="mt-10 grid gap-12">
          {groups.map((g) => (
            <div key={g.heading} data-plan-group={g.heading}>
              <h3 className={eyebrow}>{g.heading}</h3>
              <ul className="mt-2 divide-y divide-[color:var(--rule)]">
                {g.lines.map((l) => (
                  <Line key={l.label} label={l.label} detail={l.detail} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="questions" className="mt-20 border-t border-[color:var(--rule)] pt-12">
        <h2 id="questions" className={h2}>
          Questions about pricing
        </h2>
        <dl className="mt-8 divide-y divide-[color:var(--rule)]">
          {FAQS.map((f) => (
            <div key={f.q} className="py-5">
              <dt className="text-[15px] font-semibold text-[color:var(--ink)]">{f.q}</dt>
              <dd className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-[color:var(--ink-2)]">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="quote"
        className="mt-20 rounded-2xl bg-[color:var(--night)] px-7 py-12 text-[color:var(--paper)] sm:px-12"
      >
        <h2 id="quote" className="font-display text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] tracking-[-0.015em]">
          Ask for a quote
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/65">
          Tell us your restaurant&apos;s name, its city, how many branches you run and which plan you&apos;re looking at,
          and we&apos;ll send you a figure.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <a
            href={quoteHref()}
            className="inline-flex h-11 items-center rounded-sm bg-[color:var(--paper)] px-6 text-[13px] font-semibold text-[color:var(--night)] transition-colors hover:bg-violet-300"
          >
            Email us for a quote
          </a>
          <a href={`mailto:${COMPANY_EMAIL}`} className="text-[13px] text-white/60 transition-colors hover:text-white">
            {COMPANY_EMAIL}
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
