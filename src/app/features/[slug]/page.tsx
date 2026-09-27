import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeaturePageView } from "@/components/marketing/feature-page";
import { FEATURES, getFeature } from "@/lib/marketing/features";

// One page per feature, prerendered at build time; a slug that isn't one of them is a 404, not a
// page rendered on demand from whatever someone typed.
export const dynamicParams = false;

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: PageProps<"/features/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) return {};
  return {
    title: { absolute: feature.title },
    description: feature.description,
    alternates: { canonical: `/features/${feature.slug}` },
    openGraph: { title: feature.title, description: feature.description, url: `/features/${feature.slug}`, type: "website" },
  };
}

export default async function FeaturePage({ params }: PageProps<"/features/[slug]">) {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) notFound();
  return <FeaturePageView feature={feature} />;
}
