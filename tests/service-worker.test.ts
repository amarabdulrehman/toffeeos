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

function harness(fetchImpl: (url: string) => Promise<Response>) {
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
    async send(data: unknown) {
      const waits: Promise<unknown>[] = [];
      for (const fn of listeners.message ?? []) fn({ data, waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
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
