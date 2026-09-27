import { test, expect } from "@playwright/test";
import { FEATURES } from "../src/lib/marketing/features";

/**
 * The marketing site's feature pages, as a crawler and an assistant receive them.
 *
 * Fetched as plain HTML with no JavaScript, because that is what most crawlers read: the heading,
 * the answer under it and the structured data have to be in the response, not added later. Each
 * page is its own page — its own title, description and canonical — and links to its neighbours.
 *
 * And one guard that matters more than the rest: these pages never claim what ToffeeOS doesn't do.
 * PRA e-IMS integration, FBR digital invoicing, Foodpanda integration and Urdu don't exist, and
 * WhatsApp messages have never been delivered (the integration waits on Meta). A page that names
 * any of them fails here before it can reach a search result or an assistant's answer.
 */

const FORBIDDEN = /e-?IMS|\bFBR\b|foodpanda|\burdu\b|whatsapp/i;
const PAGES = ["/features", ...FEATURES.map((f) => `/features/${f.slug}`)];

function attr(html: string, re: RegExp): string | null {
  return html.match(re)?.[1] ?? null;
}

test.describe("Feature pages", () => {
  test("each is its own page: title, description, canonical, one H1, and the text is in the HTML", async ({ request }) => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const path of PAGES) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const html = await res.text();

      const title = attr(html, /<title>([^<]+)<\/title>/);
      const description = attr(html, /<meta name="description" content="([^"]+)"/);
      expect(title, `${path} has a title`).toBeTruthy();
      expect(description, `${path} has a description`).toBeTruthy();
      expect(titles.has(title!), `${path}'s title is its own`).toBe(false);
      expect(descriptions.has(description!), `${path}'s description is its own`).toBe(false);
      titles.add(title!);
      descriptions.add(description!);
      expect(description!.length, `${path}'s description fits in a search result`).toBeLessThanOrEqual(160);

      expect(attr(html, /<link rel="canonical" href="([^"]+)"/), `${path}'s canonical`).toBe(`https://toffeeos.com${path}`);
      expect(html.match(/<h1[\s>]/g) ?? [], `${path} has exactly one H1`).toHaveLength(1);
      expect(html, `${path} isn't hidden from search`).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    }

    // The words themselves, in the server's HTML — not added by JavaScript after load.
    for (const f of FEATURES) {
      const html = await (await request.get(`/features/${f.slug}`)).text();
      expect(html).toContain(f.h1.replace(/'/g, "&#x27;"));
      for (const s of f.sections) expect(html, `${f.slug}: "${s.heading}"`).toContain(s.heading.replace(/'/g, "&#x27;"));
    }
  });

  test("structured data is valid JSON with breadcrumbs that lead to real pages", async ({ request }) => {
    for (const path of PAGES) {
      const html = await (await request.get(path)).text();
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(blocks.length, `${path} has structured data`).toBeGreaterThan(0);
      for (const b of blocks) {
        const data = JSON.parse(b);
        expect(data["@context"]).toBe("https://schema.org");
        if (data["@type"] === "BreadcrumbList") {
          const items = data.itemListElement as { position: number; item: string }[];
          items.forEach((it, i) => expect(it.position).toBe(i + 1));
          expect(items.at(-1)!.item, `${path}'s breadcrumb ends at itself`).toBe(`https://toffeeos.com${path}`);
        }
      }
    }
  });

  test("every link between them goes somewhere, and the sitemap lists them", async ({ request }) => {
    const seen = new Set<string>();
    for (const path of PAGES) {
      const html = await (await request.get(path)).text();
      for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
        if (href.startsWith("/_next") || seen.has(href)) continue;
        seen.add(href);
        const res = await request.get(href, { maxRedirects: 0 });
        expect([200, 307, 308], `${path} links to ${href}`).toContain(res.status());
      }
    }
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const path of PAGES) expect(sitemap, `sitemap lists ${path}`).toContain(`<loc>https://toffeeos.com${path}</loc>`);
  });

  test("no page claims PRA e-IMS, FBR, Foodpanda, Urdu or WhatsApp", async ({ request }) => {
    for (const path of PAGES) {
      const html = await (await request.get(path)).text();
      // The visible text only: script and style blocks can carry unrelated strings.
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
      expect(text.match(FORBIDDEN)?.[0] ?? null, `${path} names something ToffeeOS doesn't do`).toBeNull();
    }
  });
});
