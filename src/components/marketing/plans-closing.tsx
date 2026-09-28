"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Eyebrow, Reveal } from "./motion";
import { RevealLines, TiltCard } from "./anim";
import { InstagramGlyph } from "./site-chrome";
import { BRAND_NAME, COMPANY_EMAIL, COMPANY_INSTAGRAM, COMPANY_INSTAGRAM_HANDLE, COMPANY_NAME } from "@/config/brand";
import { GATEABLE_MODULES, TIER_LABEL, TIER_MAX_BRANCHES, TIER_ORDER, tierMeets, type TierKey } from "@/lib/tiers";

/**
 * Plans, and the closing ask.
 *
 * The plan contents are still generated from GATEABLE_MODULES rather than retyped, so the page
 * cannot promise a module a tier does not actually unlock — and the branch count from
 * TIER_MAX_BRANCHES, which is what the app enforces. Starter used to list "Multi-branch" among
 * what every plan includes; Starter is one branch.
 *
 * Still no prices: billing is per branch, per month and set per tenant, so there is no public
 * number to print that would not be invented. Each plan mails KRIMSOLS with that plan in the
 * subject line, which is the more useful outcome anyway — a quote based on their branch count.
 */

// "Tables, grouped by floor", not "floor plan": tables are listed under their floor, with no map
// of the room to arrange them on (RestaurantTable.posX/posY exist in the schema but nothing reads
// or writes them).
const CORE = [
  "Point of sale & offline mode",
  "Kitchen display",
  "Tables, grouped by floor",
  "Menu, variants & modifiers",
  "Sales & staff reports",
  "Staff, roles & permissions",
];

function branchesLine(tier: TierKey) {
  const max = TIER_MAX_BRANCHES[tier];
  if (max === null) return "Any number of branches";
  return max === 1 ? "One branch" : `Up to ${max} branches`;
}

const PITCH: Record<TierKey, string> = {
  starter: "One counter, running properly.",
  growth: "Watching stock and margins, not just sales.",
  complete: "Delivery, online orders and payroll too.",
};

/**
 * Modules the plans don't advertise yet, though a tier unlocks them in the app. WhatsApp messaging
 * waits on Meta's approval and has never delivered a message; it goes back on the page the day one
 * is delivered.
 */
const NOT_ADVERTISED = new Set(["whatsapp"]);

function modulesFor(tier: TierKey) {
  return GATEABLE_MODULES.filter((m) => !NOT_ADVERTISED.has(m.key) && tierMeets(tier, m.minTier)).map((m) => m.label);
}

function quoteHref(tier: TierKey) {
  return `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(`${BRAND_NAME} — ${TIER_LABEL[tier]} plan enquiry`)}`;
}

export function Plans() {
  return (
    <section id="plans" className="scroll-mt-20 border-t border-[color:var(--rule)] py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <Eyebrow className="text-[color:var(--ink-3)]">Plans</Eyebrow>
          <RevealLines
            lines={["Priced per branch,", "not per seat."]}
            className="font-display mt-5 text-[clamp(2.1rem,4.8vw,3.5rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]"
          />
          <p className="mt-6 text-[15px] leading-relaxed text-[color:var(--ink-2)]">
            Add as many cashiers as you have. Tell us how many locations you run and what you need,
            and we will quote you properly.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-[color:var(--rule)] bg-[color:var(--rule)] lg:grid-cols-3">
          {TIER_ORDER.map((tier, i) => {
            const featured = tier === "growth";
            return (
              <Reveal key={tier} delay={0.08 * i} className="h-full">
                <TiltCard className={`h-full ${featured ? "bg-white" : "bg-[color:var(--paper-2)]"}`}>
                <div className="flex h-full flex-col p-8">
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-display text-2xl text-[color:var(--ink)]">{TIER_LABEL[tier]}</h3>
                    {featured && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-violet-800 uppercase">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-2.5 text-[14px] text-[color:var(--ink-2)]">{PITCH[tier]}</p>

                  <a
                    href={quoteHref(tier)}
                    className={`mt-7 inline-flex h-10 items-center justify-center rounded-sm text-[13px] font-semibold transition-colors duration-200 ${
                      featured
                        ? "bg-[color:var(--ink)] text-[color:var(--paper)] hover:bg-[color:var(--accent)]"
                        : "border border-[color:var(--rule)] text-[color:var(--ink)] hover:border-[color:var(--ink)]"
                    }`}
                  >
                    Get a quote
                  </a>

                  <p className="mt-8 text-[11px] font-medium tracking-[0.16em] text-[color:var(--ink-3)] uppercase">
                    {tier === "starter" ? "Includes" : "Everything in Starter, plus"}
                  </p>
                  <ul className="mt-4 space-y-2.5">
                    {[branchesLine(tier), ...(tier === "starter" ? CORE : modulesFor(tier))].map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-[color:var(--ink-2)]">
                        <Check className="mt-[3px] size-3.5 shrink-0 text-[color:var(--accent)]" strokeWidth={3} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                </TiltCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * The closing ask, set on ink rather than paper.
 *
 * The page runs paper → dark (the outage) → paper → dark again here, so the two dark sections
 * bookend the argument and the last thing a visitor sees has weight. It also puts the company mark
 * on the background its dark variant was built for.
 */
export function Closing() {
  return (
    <section id="contact" className="tos-grain relative scroll-mt-20 overflow-hidden bg-[color:var(--night)] py-28 sm:py-36">
      <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
        <Reveal>
          <p className="tos-folio text-white/35">06 — START</p>
          <RevealLines
            lines={["Put it on your counter", "this week."]}
            accentIndex={1}
            accentClassName="italic text-violet-300"
            className="font-display mt-6 max-w-2xl text-[clamp(2.3rem,5.6vw,4rem)] leading-[1.0] tracking-[-0.018em] text-[color:var(--paper)]"
          />
          <p className="mt-7 max-w-md text-[15px] leading-[1.65] text-white/50">
            Start the trial and look around yourself, or talk to us first — we will set up your menu,
            your branches and your tax rates with you.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/signup"
              className="group inline-flex h-12 items-center gap-2 rounded-sm bg-[color:var(--paper)] px-7 text-[13px] font-semibold whitespace-nowrap text-[color:var(--night)] transition-colors hover:bg-violet-300"
            >
              Start free trial
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <a
              href={`mailto:${COMPANY_EMAIL}`}
              className="border-b border-white/25 pb-0.5 text-[13px] font-medium text-white/70 transition-colors hover:border-white hover:text-white"
            >
              Talk to us instead
            </a>
          </div>

          <div className="mt-16 flex flex-col gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-end sm:justify-between">
            <Image src="/krimsol-logo-dark.png" alt={COMPANY_NAME} width={284} height={190} className="h-10 w-auto" />
            <div className="flex flex-col gap-2 text-[13px] sm:items-end">
              <a href={`mailto:${COMPANY_EMAIL}`} className="text-white/45 transition-colors hover:text-white">
                {COMPANY_EMAIL}
              </a>
              <a
                href={COMPANY_INSTAGRAM}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 text-white/45 transition-colors hover:text-white"
              >
                <InstagramGlyph className="size-4" />
                {COMPANY_INSTAGRAM_HANDLE}
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
