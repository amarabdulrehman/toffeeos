import Link from "next/link";
import { Breadcrumbs, MarketingShell } from "./marketing-shell";
import { breadcrumbLd, JsonLd } from "./json-ld";
import { COMPANY_EMAIL, COMPANY_NAME } from "@/config/brand";
import { FEATURES, type Feature } from "@/lib/marketing/features";
import { minTierFor, plansSentence, quoteHref } from "@/lib/marketing/plans";
import { TIER_LABEL } from "@/lib/tiers";

/**
 * One feature page (/features/[slug]), in the marketing site's shared frame.
 *
 * Server-rendered and free of client JavaScript: the whole text is in the HTML a crawler or an AI
 * assistant fetches. Which plans include the feature is worked out from the tiers
 * (plansSentence), never typed into the copy. Where the free trial, which runs on Starter, doesn't
 * include the feature, the page says so rather than sending someone to a trial without it.
 */
export function FeaturePageView({ feature }: { feature: Feature }) {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Features", path: "/features" },
    { name: feature.name, path: `/features/${feature.slug}` },
  ];
  const related = feature.related.map((s) => FEATURES.find((f) => f.slug === s)).filter((f): f is Feature => !!f);
  const minTier = minTierFor(feature.modules);
  const inTrial = minTier === "starter";

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd(trail)} />
      <Breadcrumbs trail={trail} />

      <p className="tos-folio mt-10">{feature.folio}</p>
      <h1 className="font-display mt-4 max-w-3xl text-[clamp(2.2rem,5.2vw,3.6rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]">
        {feature.h1}
      </h1>
      <p className="mt-7 max-w-2xl text-[17px] leading-[1.65] text-[color:var(--ink-2)]">{feature.lead}</p>
      <p className="mt-5 text-[13.5px] text-[color:var(--ink-3)]">
        <span data-feature-plans className="font-medium text-[color:var(--ink)]">
          {plansSentence(feature.modules)}.
        </span>{" "}
        <Link href="/pricing" className="border-b border-[color:var(--rule)] pb-px transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]">
          See pricing
        </Link>
      </p>

      <div className="mt-14 space-y-12">
        {feature.sections.map((s) => (
          <section key={s.heading} className="border-t border-[color:var(--rule)] pt-8">
            <h2 className="font-display text-[clamp(1.45rem,2.6vw,1.9rem)] leading-[1.15] tracking-[-0.01em] text-[color:var(--ink)]">
              {s.heading}
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-[1.7] text-[color:var(--ink)]">{s.answer}</p>
            {s.points && (
              <ul className="mt-5 max-w-2xl space-y-3">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-3 text-[15px] leading-[1.65] text-[color:var(--ink-2)]">
                    <span aria-hidden className="mt-[0.7em] h-px w-3 shrink-0 bg-[color:var(--ink-3)]" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="rounded-sm border border-[color:var(--rule)] p-6 sm:p-8">
          <h2 className="font-display text-[1.5rem] leading-tight text-[color:var(--ink)]">What it doesn&apos;t do</h2>
          <p className="mt-2 text-[14px] text-[color:var(--ink-3)]">Said plainly, so nobody finds out after buying.</p>
          <ul className="mt-5 space-y-3">
            {feature.limits.map((l) => (
              <li key={l} className="flex gap-3 text-[15px] leading-[1.65] text-[color:var(--ink-2)]">
                <span aria-hidden className="mt-[0.7em] h-px w-3 shrink-0 bg-[color:var(--ink-3)]" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </section>

        {related.length > 0 && (
          <section className="border-t border-[color:var(--rule)] pt-8">
            <h2 className="font-display text-[1.5rem] leading-tight text-[color:var(--ink)]">Works with</h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/features/${r.slug}`}
                    className="block h-full rounded-sm border border-[color:var(--rule)] p-5 transition-colors hover:border-[color:var(--ink-3)]"
                  >
                    <span className="block font-medium text-[color:var(--ink)]">{r.name} →</span>
                    <span className="mt-1.5 block text-[14px] leading-[1.6] text-[color:var(--ink-3)]">{r.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-[color:var(--rule)] pt-10">
          <h2 className="font-display text-[1.5rem] leading-tight text-[color:var(--ink)]">Try it on your own menu</h2>
          {inTrial ? (
            <p className="mt-3 max-w-xl text-[15px] leading-[1.65] text-[color:var(--ink-2)]">
              Start a free trial and set up a branch, or email us and we&apos;ll walk you through it.
            </p>
          ) : (
            <p className="mt-3 max-w-xl text-[15px] leading-[1.65] text-[color:var(--ink-2)]" data-trial-note>
              The free trial runs on the Starter plan, which doesn&apos;t include this. To see it on your own menu first, say
              so when you ask for a quote.
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            {inTrial ? (
              <>
                <Link
                  href="/signup"
                  className="inline-flex h-11 items-center rounded-sm bg-[color:var(--ink)] px-6 text-[13px] font-semibold text-[color:var(--paper)] transition-colors hover:bg-[color:var(--accent)]"
                >
                  Start free trial
                </Link>
                <a
                  href={`mailto:${COMPANY_EMAIL}`}
                  className="border-b border-[color:var(--rule)] pb-0.5 text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
                >
                  Email {COMPANY_NAME}
                </a>
              </>
            ) : (
              <>
                <a
                  href={quoteHref(minTier)}
                  className="inline-flex h-11 items-center rounded-sm bg-[color:var(--ink)] px-6 text-[13px] font-semibold text-[color:var(--paper)] transition-colors hover:bg-[color:var(--accent)]"
                >
                  Ask for a {TIER_LABEL[minTier]} quote
                </a>
                <Link
                  href="/signup"
                  className="border-b border-[color:var(--rule)] pb-0.5 text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
                >
                  Or start the free trial
                </Link>
              </>
            )}
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
