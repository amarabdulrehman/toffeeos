import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/brand";

/**
 * /sitemap.xml — the pages meant to be found. Sign-in pages are noindex and not listed; each
 * restaurant's ordering page (/order/[slug]) is the restaurant's own, found from its links, not
 * ToffeeOS's marketing.
 *
 * lastModified only where it is known: a date that changed on every deploy would tell search
 * engines nothing true.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: new Date("2026-09-28"), changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, lastModified: new Date("2026-09-28"), changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
