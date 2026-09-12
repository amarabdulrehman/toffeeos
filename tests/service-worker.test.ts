import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * public/sw.js is what lets the till open with no internet, and nothing else covers it: it is
 * plain JS served as a static file, so it is not typechecked, not bundled, and not reachable from
 * the e2e suite (Playwright's context has no service worker registered, and the real thing only
 * runs in production builds).
 *
 * So it gets loaded into a sandbox with fake caches/fetch and driven directly. What is actually
 * being protected here is the warm-up guard: warming fetches routes the user may not have
 * permission for, and caching the resulting redirect would leave a café tablet showing the login
 * screen as though it were the POS, offline, with no way to tell why.
 */

type Listener = (event: { data: unknown; waitUntil: (p: Promise<unknown>) => void }) => void;

class FakeCache {
  store = new Map<string, Response>();
  async put(req: string | Request, res: Response) {
    this.store.set(typeof req === "string" ? req : req.url, res);
  }
  async match(req: string | Request) {
    return this.store.get(typeof req === "string" ? req : req.url);
  }
}

type Net = (url: string) => Promise<Response>;

function harness(route: Net) {
  // The worker calls fetch() with a bare string when warming and with a Request when handling a
  // navigation. Normalising here keeps each test's routing table readable — and getting this wrong
  // is what made the first version of these tests pass through a 404 instead of the offline path.
  let online = true;
  const fetchImpl = async (input: string | { url: string }) => {
    if (!online) throw new TypeError("Failed to fetch");
    const raw = typeof input === "string" ? input : input.url;
    return route(raw.replace("https://toffeeos.com", ""));
  };
  const cacheStorage = {
    _caches: new Map<string, FakeCache>(),
    async open(name: string) {
      if (!this._caches.has(name)) this._caches.set(name, new FakeCache());
      return this._caches.get(name)!;
    },
    async keys() {
      return [...this._caches.keys()];
    },
    async delete(name: string) {
      return this._caches.delete(name);
    },
    async match(req: string) {
      for (const c of this._caches.values()) {
        const hit = await c.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const listeners: Record<string, Listener[]> = {};
  const self = {
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ||= []).push(fn);
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: "https://toffeeos.com" },
  };

  const src = readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
  vm.runInNewContext(src, { self, caches: cacheStorage, fetch: fetchImpl, Response, URL, console });

  return {
    caches: cacheStorage,
    /** Cuts the line, the way a café's connection goes mid-shift. */
    goOffline() {
      online = false;
    },
    async send(data: unknown) {
      const waits: Promise<unknown>[] = [];
      for (const fn of listeners.message ?? []) fn({ data, waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    /** Drives the fetch handler as a browser would for a top-level navigation. */
    async navigate(url: string): Promise<Response | undefined> {
      const request = { method: "GET", mode: "navigate", url: `https://toffeeos.com${url}`, destination: "document" };
      let responded: Promise<Response> | undefined;
      for (const fn of listeners.fetch ?? [])
        (fn as unknown as (e: unknown) => void)({
          request,
          respondWith: (p: Promise<Response>) => {
            responded = p;
          },
        });
      return responded ? await responded : undefined;
    },
  };
}

const html = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

const redirected = (body: string) => {
  const res = html(body);
  Object.defineProperty(res, "redirected", { value: true });
  return res;
};

/** Read straight out of sw.js so a CACHE_VERSION bump doesn't quietly make these tests vacuous. */
function pagesCacheName() {
  const src = readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
  const version = /const CACHE_VERSION = "([^"]+)"/.exec(src)?.[1];
  expect(version, "CACHE_VERSION not found in sw.js — did the constant get renamed?").toBeTruthy();
  return `toffeeos-pages-${version}`;
}

describe("service worker page warming", () => {
  const fetches: string[] = [];
  const fetchImpl = async (url: string) => {
    fetches.push(url);
    if (url === "/pos") return html("<h1>TILL</h1>");
    if (url === "/kds") return redirected("<h1>LOGIN</h1>"); // no permission -> bounced to login
    if (url === "/api/thing") return new Response("{}", { headers: { "Content-Type": "application/json" } });
    if (url === "/boom") throw new Error("offline");
    return new Response("nope", { status: 404 });
  };

  it("caches a real page, and refuses everything that isn't one", async () => {
    fetches.length = 0;
    const sw = harness(fetchImpl);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos", "/kds", "/api/thing", "/boom", "/missing"] });

    const pages = await sw.caches.open(pagesCacheName());

    // It tried all five — otherwise the assertions below could pass by simply doing nothing.
    expect(fetches).toHaveLength(5);

    const pos = await pages.match("/pos");
    expect(pos, "the till should be cached").toBeTruthy();
    expect(await pos!.clone().text()).toContain("TILL");

    expect(await pages.match("/kds"), "a redirect to login must never be cached as the KDS").toBeUndefined();
    expect(await pages.match("/api/thing"), "non-HTML must not be cached as a page").toBeUndefined();
    expect(await pages.match("/boom"), "a failed fetch must not cache anything").toBeUndefined();
    expect(await pages.match("/missing"), "a 404 must not be cached as a page").toBeUndefined();

    expect(pages.store.size).toBe(1);
  });

  it("clears cached pages on sign-out, so a shared tablet can't leak the last cashier's screen", async () => {
    const sw = harness(fetchImpl);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"] });
    expect((await sw.caches.open(pagesCacheName())).store.size).toBe(1);

    await sw.send({ type: "CLEAR_PAGES" });
    expect((await sw.caches.open(pagesCacheName())).store.size).toBe(0);
  });

  it("ignores messages it doesn't recognise", async () => {
    const sw = harness(fetchImpl);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"] });
    await sw.send({ type: "SOMETHING_ELSE" });
    await sw.send(null);
    expect(await (await sw.caches.open(pagesCacheName())).match("/pos")).toBeTruthy();
  });
});

describe("offline navigation fallback", () => {
  /** The app as the worker sees it: /pos and /kds are real pages, everything else is a 404. */
  const routes: Net = async (url) =>
    url === "/pos" || url === "/kds" ? html(`<h1>${url}</h1>`) : new Response("nope", { status: 404 });

  it("serves the warmed till instead of the fallback once the line drops", async () => {
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"] });

    sw.goOffline();
    const res = await sw.navigate("/pos");

    const body = await res!.text();
    expect(body, "the whole point: a warmed till must render offline").toContain("/pos");
    expect(body).not.toContain("You're offline");
  });

  it("offers the till when it is cached, so an uncached screen isn't a dead end", async () => {
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"] });

    sw.goOffline();
    const res = await sw.navigate("/app/reports");

    expect(res!.status).toBe(503);
    const body = await res!.text();
    expect(body).toContain("You're offline");
    expect(body, "staff mid-shift need a way back to the till").toContain('href="/pos"');
  });

  it("does not offer the till when it isn't cached, rather than linking to a dead end", async () => {
    const sw = harness(routes);
    sw.goOffline();
    const res = await sw.navigate("/app/reports");

    expect(res!.status).toBe(503);
    const body = await res!.text();
    expect(body).toContain("You're offline");
    expect(body, "a link that just bounces back here teaches staff the button is broken").not.toContain(
      'href="/pos"'
    );
  });

  it("prefers the network while it is up, so staff never see a stale build online", async () => {
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"] });

    // Still online: the response must come from the network, not the cache.
    const res = await sw.navigate("/pos");
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain("/pos");
  });
});

describe("build-aware page cache", () => {
  const routes: Net = async (url) => html(`<h1>${url}</h1>`);

  it("keeps cached pages while the build is unchanged", async () => {
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"], buildId: "abc123" });
    const first = await (await sw.caches.open(pagesCacheName())).match("/pos");
    expect(first).toBeTruthy();

    await sw.send({ type: "WARM_PAGES", urls: [], buildId: "abc123" });
    expect(await (await sw.caches.open(pagesCacheName())).match("/pos")).toBeTruthy();
  });

  it("drops pages cached from an older build", async () => {
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos", "/app/reports"], buildId: "old-build" });
    expect(await (await sw.caches.open(pagesCacheName())).match("/app/reports")).toBeTruthy();

    // A deploy lands. The tablet reloads and announces the new build.
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"], buildId: "new-build" });
    const cache = await sw.caches.open(pagesCacheName());

    expect(
      await cache.match("/app/reports"),
      "a page from the previous build must not survive — this is the stale-POS bug"
    ).toBeUndefined();
    expect(await cache.match("/pos"), "the re-warmed page must be present after the purge").toBeTruthy();
  });

  it("purges before warming, not after", async () => {
    // Ordering matters: warm-then-purge would fetch the new pages and then throw them away,
    // leaving the cache empty and the next outage uncovered.
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"], buildId: "v1" });
    await sw.send({ type: "WARM_PAGES", urls: ["/pos", "/kds"], buildId: "v2" });

    const cache = await sw.caches.open(pagesCacheName());
    expect(await cache.match("/pos")).toBeTruthy();
    expect(await cache.match("/kds")).toBeTruthy();
  });

  it("does nothing when the app sends no build id", async () => {
    // An older client that predates buildId must not have its cache wiped on every message.
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"], buildId: "v1" });
    await sw.send({ type: "WARM_PAGES", urls: [] });
    expect(await (await sw.caches.open(pagesCacheName())).match("/pos")).toBeTruthy();
  });

  it("never serves the build marker as a page", async () => {
    const sw = harness(routes);
    await sw.send({ type: "WARM_PAGES", urls: ["/pos"], buildId: "v1" });
    sw.goOffline();

    const res = await sw.navigate("/__toffeeos_build__");
    const body = await res!.text();
    expect(body, "the marker is a build id, not HTML — it must never render as a page").not.toContain("v1");
  });
});
