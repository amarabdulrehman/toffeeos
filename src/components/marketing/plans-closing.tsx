"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Eyebrow, Reveal } from "./motion";
import { InstagramGlyph } from "./site-chrome";
import { BRAND_NAME, COMPANY_EMAIL, COMPANY_INSTAGRAM, COMPANY_INSTAGRAM_HANDLE, COMPANY_NAME } from "@/config/brand";
import { GATEABLE_MODULES, TIER_LABEL, TIER_ORDER, tierMeets, type TierKey } from "@/lib/tiers";

/**
 * Plans, and the closing ask.
 *
 * The plan contents are still generated from GATEABLE_MODULES rather than retyped, so the page
 * cannot promise a module a tier does not actually unlock.
 *
 * Still no prices: billing is per branch, per month and set per tenant, so there is no public
 * number to print that would not be invented. Each plan mails KRIMSOLS with that plan in the
 * subject line, which is the more useful outcome anyway — a quote based on their branch count.
 */

const CORE = [
  "Point of sale & offline mode",
  "Kitchen display",
  "Tables & floor plan",
  "Menu, variants & modifiers",
  "Sales & staff reports",
  "Staff, roles & permissions",
  "Multi-branch",
];

const PITCH: Record<TierKey, string> = {
  starter: "One counter, running properly.",
  growth: "Watching stock and margins, not just sales.",
  complete: "Delivery, online orders and payroll too.",
};

function modulesFor(tier: TierKey) {
  return GATEABLE_MODULES.filter((m) => tierMeets(tier, m.minTier)).map((m) => m.label);
}

function quoteHref(tier: TierKey) {
  return `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(`${BRAND_NAME} — ${TIER_LABEL[tier]} plan enquiry`)}`;
}

export function Plans() {
  return (
    <section id="plans" className="scroll-mt-20 border-t border-white/[0.06] bg-[#08070f] py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <Eyebrow className="text-white/35">Plans</Eyebrow>
          <h2 className="mt-5 text-[clamp(2rem,4.6vw,3.4rem)] leading-[1.02] font-bold tracking-[-0.032em] text-white">
            Priced per branch, not per seat.
          </h2>
          <p className="mt-6 text-[15px] leading-relaxed text-white/50">
            Add as many cashiers as you have. Tell us how many locations you run and what you need,
            and we will quote you properly.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] lg:grid-cols-3">
          {TIER_ORDER.map((tier, i) => {
            const featured = tier === "growth";
            return (
              <Reveal key={tier} delay={0.08 * i} className="h-full">
                <div className={`flex h-full flex-col p-8 ${featured ? "bg-white/[0.045]" : "bg-[#0b0a13]"}`}>
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-lg font-bold text-white">{TIER_LABEL[tier]}</h3>
                    {featured && (
                      <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-violet-200 uppercase">
                        Most start here
                      </span>
                    )}
                  </div>
                  <p className="mt-2.5 text-[14px] text-white/45">{PITCH[tier]}</p>

                  <a
                    href={quoteHref(tier)}
                    className={`mt-7 inline-flex h-10 items-center justify-center rounded-full text-[13px] font-semibold transition-all duration-200 hover:scale-[1.02] ${
                      featured
                        ? "bg-white text-black"
                        : "border border-white/15 text-white/85 hover:border-white/30"
                    }`}
                  >
                    Get a quote
                  </a>

                  <p className="mt-8 text-[11px] font-medium tracking-[0.16em] text-white/30 uppercase">
                    {tier === "starter" ? "Includes" : "Everything in Starter, plus"}
                  </p>
                  <ul className="mt-4 space-y-2.5">
                    {(tier === "starter" ? CORE : modulesFor(tier)).map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-white/65">
                        <Check className="mt-[3px] size-3.5 shrink-0 text-violet-300" strokeWidth={3} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <section id="contact" className="relative scroll-mt-20 overflow-hidden border-t border-white/[0.06] bg-[#08070f] py-28 sm:py-40">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 h-[34rem] w-[54rem] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.28),transparent_65%)] blur-2xl"
      />
      <div className="relative mx-auto max-w-3xl px-5 text-center sm:px-8">
        <Reveal>
          <Image
            src="/krimsol-logo-dark.png"
            alt={COMPANY_NAME}
            width={284}
            height={190}
            className="mx-auto h-12 w-auto"
          />
          <h2 className="mt-9 text-[clamp(2.1rem,5.2vw,3.6rem)] leading-[1.02] font-bold tracking-[-0.034em] text-white">
            Put it on your counter this week.
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-white/55">
            Start the trial and look around yourself, or talk to us first — we will set up your menu,
            your branches and your tax rates with you.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-semibold text-black transition-transform duration-200 hover:scale-[1.03] active:scale-[0.99] sm:w-auto"
            >
              Start free trial
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <a
              href={`mailto:${COMPANY_EMAIL}`}
              className="inline-flex h-12 w-full items-center justify-center rounded-full border border-white/15 px-8 text-sm font-medium text-white/85 transition-colors hover:border-white/30 hover:text-white sm:w-auto"
            >
              Talk to us
            </a>
          </div>

          <div className="mt-12 flex flex-col items-center justify-center gap-x-8 gap-y-3 text-[13.5px] sm:flex-row">
            <a
              href={`mailto:${COMPANY_EMAIL}`}
              className="text-white/45 transition-colors hover:text-white"
            >
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
        </Reveal>
      </div>
    </section>
  );
}
