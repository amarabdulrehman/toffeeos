import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/brand";

/**
 * /robots.txt — every crawler, AI assistants' included, may read the public site; the signed-in
 * product and the API are off limits (they redirect to a login anyway).
 *
 * The sign-in pages are deliberately NOT disallowed here: they carry `noindex`, and a crawler has
 * to be allowed to fetch a page to see that. Disallowing them would hide the noindex and leave the
 * bare URL free to appear in results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // The rider's sign-in page is noindex; allowed so a crawler can read that.
      allow: ["/", "/rider/login"],
      disallow: ["/app/", "/pos", "/kds", "/platform/", "/rider/", "/api/", "/impersonate", "/change-password"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
