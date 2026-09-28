import { BRAND_NAME, COMPANY_EMAIL, COMPANY_NAME, SITE_URL } from "@/config/brand";

/**
 * Structured data (schema.org JSON-LD) for the marketing pages.
 *
 * Every property here was checked against schema.org's own vocabulary for its type, and every
 * statement against the code: nothing about PRA e-IMS, FBR, Foodpanda, Urdu or WhatsApp, none of
 * which ToffeeOS does today (e2e/public-claims.spec.ts fails if they appear).
 *
 * No `offers` and no ratings: prices are quoted rather than published, and there are no reviews to
 * cite — inventing either would be worse than leaving them out. The cost is that Google won't show
 * the software rich result (it wants a price and a rating); the gain is that search engines and AI
 * assistants read, from the site itself, what ToffeeOS is, who makes it and what it does.
 */

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: COMPANY_NAME,
  url: SITE_URL,
  email: COMPANY_EMAIL,
  logo: `${SITE_URL}/krimsol-logo.png`,
  // The profile itself, not the shared link in src/config/brand.ts, which carries a share token.
  sameAs: ["https://www.instagram.com/krimsols/"],
  brand: { "@type": "Brand", name: BRAND_NAME },
};

export const softwareApplicationLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: BRAND_NAME,
  url: SITE_URL,
  description:
    "Restaurant management software for Pakistan: a point of sale that keeps taking orders and payments through internet outages, with a kitchen display, inventory and recipes, delivery, online ordering, reports and payroll.",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Restaurant point of sale",
  operatingSystem: "Web browser",
  countriesSupported: "PK",
  inLanguage: "en",
  publisher: { "@id": ORGANIZATION_ID },
  featureList: [
    "Point of sale for dine-in, takeaway and delivery that keeps working offline",
    "Cash and card taxed at their own rates on one bill",
    "Kitchen display system",
    "Inventory with recipes that deduct stock on every paid order",
    "Recipe costing and margins",
    "Purchase orders, suppliers and transfers between branches",
    "Tables grouped by floor",
    "Multi-branch management",
    "Online ordering site and QR table ordering with no per-order fee",
    "Delivery with riders and proof of delivery",
    "Loyalty points",
    "Daily sales, expenses and profit and loss reports",
    "Staff roles, permissions, payroll and HR",
  ],
};

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

/** Questions and answers exactly as the page shows them. Google requires the marked-up text to be
 * visible, so the page and this block are rendered from the same list. */
export function faqLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** A schema.org block, escaped so nothing in it can close the script tag. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
