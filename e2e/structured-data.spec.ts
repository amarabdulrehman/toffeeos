import { test, expect } from "@playwright/test";

/**
 * What search engines and AI assistants read about ToffeeOS from the site itself: the homepage's
 * structured data and /llms.txt.
 *
 * Invalid structured data is worse than none, so every block must parse, and every property must
 * be one schema.org defines for its type — the list below was checked against schema.org's own
 * vocabulary, and a property added without checking it fails here. Neither may name what ToffeeOS
 * doesn't do (the same guard as e2e/public-claims.spec.ts, which reads only visible text and so
 * can't see either of these).
 */

const FORBIDDEN = /e-?IMS|\bFBR\b|foodpanda|\burdu\b|whatsapp/i;

// Checked against schema.org's vocabulary (schemaorg-current-https.jsonld), 27 September 2026.
const ALLOWED: Record<string, string[]> = {
  Organization: ["name", "url", "email", "logo", "sameAs", "brand"],
  SoftwareApplication: [
    "name",
    "url",
    "description",
    "applicationCategory",
    "applicationSubCategory",
    "operatingSystem",
    "countriesSupported",
    "inLanguage",
    "publisher",
    "featureList",
  ],
  Brand: ["name"],
};

function ldBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

function checkProperties(node: Record<string, unknown>, where: string) {
  const type = node["@type"] as string | undefined;
  if (!type) return; // a bare {"@id": …} reference
  expect(Object.keys(ALLOWED), `${where}: a checked type`).toContain(type);
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@")) continue;
    expect(ALLOWED[type], `${where}: ${type}.${key} is a schema.org property`).toContain(key);
    if (value && typeof value === "object" && !Array.isArray(value)) checkProperties(value as Record<string, unknown>, `${where} › ${key}`);
  }
}

test("the homepage's structured data parses, uses only real properties and claims nothing it shouldn't", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const blocks = ldBlocks(html);
  expect(blocks.map((b) => b["@type"]).sort()).toEqual(["Organization", "SoftwareApplication"]);

  for (const block of blocks) {
    expect(block["@context"]).toBe("https://schema.org");
    checkProperties(block, String(block["@type"]));
    expect(JSON.stringify(block).match(FORBIDDEN)?.[0] ?? null, `${block["@type"]} names something ToffeeOS doesn't do`).toBeNull();
  }

  const org = blocks.find((b) => b["@type"] === "Organization")!;
  const app = blocks.find((b) => b["@type"] === "SoftwareApplication")!;
  expect(app.publisher, "the app points at the organisation").toEqual({ "@id": org["@id"] });
  // No price or rating is published, so none is claimed.
  expect(app).not.toHaveProperty("offers");
  expect(app).not.toHaveProperty("aggregateRating");

  // The logo the organisation names is really there.
  expect((await request.get(new URL(String(org.logo)).pathname)).status()).toBe(200);
});

test("llms.txt is served as plain text, names nothing ToffeeOS doesn't do, and its links resolve", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const text = await res.text();
  expect(text.startsWith("# ToffeeOS")).toBe(true);
  expect(text.match(FORBIDDEN)?.[0] ?? null, "llms.txt names something ToffeeOS doesn't do").toBeNull();

  for (const [, path] of text.matchAll(/https:\/\/toffeeos\.com(\/[^\s)]*)/g)) {
    expect((await request.get(path)).status(), `llms.txt links to ${path}`).toBe(200);
  }
});
