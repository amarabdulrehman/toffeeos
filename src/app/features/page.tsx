import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, MarketingShell } from "@/components/marketing/marketing-shell";
import { breadcrumbLd, JsonLd } from "@/components/marketing/json-ld";
import { BRAND_NAME } from "@/config/brand";
import { FEATURES, sectionModules } from "@/lib/marketing/features";
import { plansSummary } from "@/lib/marketing/plans";

const TITLE = `Restaurant Management Software Features — ${BRAND_NAME}`;
const DESCRIPTION =
  "What ToffeeOS runs for a restaurant, from the POS and kitchen display to delivery, reports and payroll, each explained plainly, limits included.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/features" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/features", type: "website" },
};

/** The hub every feature page links back to, and the homepage links into. */
export default function FeaturesIndex() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Features", path: "/features" },
  ];
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd(trail)} />
      <Breadcrumbs trail={trail} />
      <p className="tos-folio mt-10">FEATURES</p>
      <h1 className="font-display mt-4 max-w-3xl text-[clamp(2.2rem,5.2vw,3.6rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]">
        Restaurant management software, one part at a time
      </h1>
      <p className="mt-7 max-w-2xl text-[17px] leading-[1.65] text-[color:var(--ink-2)]">
        {BRAND_NAME} runs the counter, the kitchen, the storeroom and the office for restaurants and cafés in Pakistan. Each page below
        explains one part: what it does, how, and what it doesn&apos;t do.
      </p>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <li key={f.slug}>
            <Link
              href={`/features/${f.slug}`}
              className="block h-full rounded-sm border border-[color:var(--rule)] p-6 transition-colors hover:border-[color:var(--ink-3)]"
            >
              <h2 className="font-display text-[1.35rem] leading-tight text-[color:var(--ink)]">{f.name}</h2>
              <p className="mt-2 text-[14px] leading-[1.6] text-[color:var(--ink-3)]">{f.summary}</p>
              <p className="mt-3 text-[12px] font-medium text-[color:var(--ink-2)]">{plansSummary(f.modules, f.branches, sectionModules(f))}</p>
            </Link>
          </li>
        ))}
      </ul>
    </MarketingShell>
  );
}
