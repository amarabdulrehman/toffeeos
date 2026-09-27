import type { Metadata } from "next";
import { getStorefront } from "@/server/online-ordering";

/**
 * A restaurant's own online ordering page, titled with the restaurant's name so it can be found
 * under it. Indexable — it is the restaurant's storefront — but not in ToffeeOS's sitemap. A slug
 * with no open storefront behind it is kept out of results.
 *
 * A title must never cost a customer the page: the ordering page itself needs no database to load,
 * so if the lookup fails (a dropped connection), it gets a plain title and loads as it always did.
 */
export async function generateMetadata({ params }: { params: Promise<{ tenantSlug: string }> }): Promise<Metadata> {
  const { tenantSlug } = await params;
  let store: Awaited<ReturnType<typeof getStorefront>>;
  try {
    store = await getStorefront(tenantSlug);
  } catch {
    return { title: { absolute: "Online ordering" } };
  }
  if (!store) {
    return { title: { absolute: "Online ordering" }, robots: { index: false, follow: false } };
  }
  return {
    title: { absolute: `Order online — ${store.name}` },
    description: `Order from ${store.name} online.`,
    alternates: { canonical: `/order/${store.slug}` },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
