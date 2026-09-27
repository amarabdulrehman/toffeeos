import Link from "next/link";
import type { ReactNode } from "react";
import { displaySerif } from "./fonts";
import { BRAND_NAME, COMPANY_EMAIL, COMPANY_NAME, SITE_URL } from "@/config/brand";
import { FEATURES, type Feature } from "@/lib/marketing/features";

/**
 * The feature pages and the pages around them (the features index, and pricing when it exists).
 *
 * Server-rendered and free of client JavaScript: the whole text is in the HTML a crawler or an AI
 * assistant fetches, and nothing here needs the homepage's animation code. Same paper-and-ink
 * look as the homepage and the legal pages, so moving between them doesn't feel like leaving.
 */

/** Structured data, escaped so no string in it can close the script tag. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function breadcrumbLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: `${SITE_URL}${t.path}`,
    })),
  };
}

const navLink = "text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:text-[color:var(--ink)]";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={`tos-landing ${displaySerif.variable} flex min-h-svh flex-1 flex-col`}>
      <header className="border-b border-[color:var(--rule)]">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-5 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label={`${BRAND_NAME} home`}>
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-lg bg-[color:var(--ink)] text-[13px] font-bold text-[color:var(--paper)]"
            >
              T
            </span>
            <span className="font-display text-[19px] tracking-tight text-[color:var(--ink)]">{BRAND_NAME}</span>
          </Link>
          <nav aria-label="Main" className="ml-auto flex items-center gap-5">
            <Link href="/features" className={`${navLink} max-sm:hidden`}>
              Features
            </Link>
            <Link href="/login" className={navLink}>
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center rounded-sm bg-[color:var(--ink)] px-4 text-[13px] font-semibold whitespace-nowrap text-[color:var(--paper)] transition-colors hover:bg-[color:var(--accent)]"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8 sm:py-20">{children}</main>

      <footer className="border-t border-[color:var(--rule)] py-10">
        <div className="mx-auto grid max-w-4xl gap-8 px-5 text-[13px] sm:grid-cols-[1fr_auto] sm:px-8">
          <div>
            <p className="font-medium text-[color:var(--ink)]">Features</p>
            <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.slug}>
                  <Link href={`/features/${f.slug}`} className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
                    {f.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2 text-[color:var(--ink-3)] sm:items-end">
            <Link href="/terms" className="transition-colors hover:text-[color:var(--ink)]">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-[color:var(--ink)]">
              Privacy
            </Link>
            <a href={`mailto:${COMPANY_EMAIL}`} className="transition-colors hover:text-[color:var(--ink)]">
              Contact
            </a>
          </div>
          <p className="text-[12px] text-[color:var(--ink-3)] sm:col-span-2">
            © {new Date().getFullYear()} {COMPANY_NAME}. Restaurant software, built in Pakistan.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function Breadcrumbs({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[12px] text-[color:var(--ink-3)]">
      <ol className="flex flex-wrap items-center gap-1.5">
        {trail.map((t, i) => (
          <li key={t.path} className="flex items-center gap-1.5">
            {i < trail.length - 1 ? (
              <>
                <Link href={t.path} className="transition-colors hover:text-[color:var(--ink)]">
                  {t.name}
                </Link>
                <span aria-hidden>/</span>
              </>
            ) : (
              <span aria-current="page" className="text-[color:var(--ink-2)]">
                {t.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function FeaturePageView({ feature }: { feature: Feature }) {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Features", path: "/features" },
    { name: feature.name, path: `/features/${feature.slug}` },
  ];
  const related = feature.related.map((s) => FEATURES.find((f) => f.slug === s)).filter((f): f is Feature => !!f);

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd(trail)} />
      <Breadcrumbs trail={trail} />

      <p className="tos-folio mt-10">{feature.folio}</p>
      <h1 className="font-display mt-4 max-w-3xl text-[clamp(2.2rem,5.2vw,3.6rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]">
        {feature.h1}
      </h1>
      <p className="mt-7 max-w-2xl text-[17px] leading-[1.65] text-[color:var(--ink-2)]">{feature.lead}</p>

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
          <p className="mt-3 max-w-xl text-[15px] leading-[1.65] text-[color:var(--ink-2)]">
            Start a free trial and set up a branch, or email us and we&apos;ll walk you through it.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
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
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
