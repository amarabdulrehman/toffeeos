/*
 * Service worker — what lets the POS open at all when the café's internet is down.
 *
 * The offline queue (src/lib/offline/) already handled everything *after* the app is running:
 * orders, payments and voids go into IndexedDB and replay on reconnect, and menu/tables/open orders
 * are cached there too. What was missing was the app itself. A browser fetches the HTML and JS on
 * every load, so with no connection a refresh — or a slept tablet waking up, or opening the till in
 * the morning before the line is back — gave a blank page, with a full queue sitting in IndexedDB
 * that nothing could reach.
 *
 * Strategy, deliberately conservative, because the failure mode of a careless service worker is
 * pinning staff to a stale build that no amount of refreshing fixes — worse than having none:
 *
 *   /_next/static/*   cache-first. Next content-hashes these, so a given URL's bytes never change;
 *                     a new build produces new URLs. Safe to serve from cache forever.
 *   navigations       network-first, falling back to the cached copy. Online you always get the
 *                     current build. Offline you get the last page that loaded successfully.
 *   /api/*            never cached. Reads must be fresh, and writes are the offline queue's job —
 *                     a cached POST response would be a silent lie about money.
 *   other same-origin stale-while-revalidate for fonts/images: instant, and quietly refreshed.
 *
 * Bump CACHE_VERSION to force every client to drop its caches on the next activate.
 */

const CACHE_VERSION = "v2";
const STATIC_CACHE = `toffeeos-static-${CACHE_VERSION}`;
const PAGES_CACHE = `toffeeos-pages-${CACHE_VERSION}`;
const ASSETS_CACHE = `toffeeos-assets-${CACHE_VERSION}`;
const CURRENT = [STATIC_CACHE, PAGES_CACHE, ASSETS_CACHE];

self.addEventListener("install", (event) => {
  // Take over straight away rather than waiting for every tab to close. On a POS the tab can stay
  // open for days, and an update that only lands "eventually" is an update nobody gets.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("toffeeos-") && !CURRENT.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

/** An offline navigation that has no cached copy still needs to render something. */
const OFFLINE_FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#faf9f7;color:#1c1917}div{max-width:22rem;text-align:center;padding:1.5rem}
h1{font-size:1.125rem;margin:0 0 .5rem}p{font-size:.875rem;color:#57534e;margin:0 0 1rem;line-height:1.5}
button{font:inherit;padding:.5rem 1rem;border-radius:.5rem;border:1px solid #d6d3d1;background:#fff;cursor:pointer}</style>
</head><body><div><h1>You're offline</h1>
<p>This screen hasn't been opened on this device yet, so there's no saved copy to show.
Anything already taken on this till is saved and will sync once you're back online.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    // Only cache real successes — an error page cached as "the app" is how you get a till that
    // shows a 500 forever.
    if (fresh && fresh.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match(new URL(request.url).pathname));
    if (cached) return cached;
    return new Response(OFFLINE_FALLBACK_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (fresh) => {
      if (fresh && fresh.ok) {
        const cache = await caches.open(ASSETS_CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

/**
 * Warms the page cache on request from the app.
 *
 * Network-first caching only stores a page *after* it has been visited with the worker already
 * running, which left the first session uncovered: install the worker, lose the line, reload, and
 * there is nothing saved yet — the offline fallback, not the till. A café tablet should be usable
 * offline from the moment it is set up, not once someone happens to have clicked around.
 *
 * Driven by a message from the page rather than a hardcoded list in install: these routes are
 * behind auth, and fetching them from install — before any client is controlled — risks caching a
 * redirect to /login as though it were the POS. Asking once the app is running means the request
 * carries the session it needs.
 */
async function warmPages(urls) {
  const cache = await caches.open(PAGES_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        // Only a real page. A redirect to the login screen cached as /pos would be worse than an
        // empty cache: the till would "work" offline and show the wrong thing.
        if (res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html")) {
          await cache.put(url, res.clone());
        }
      } catch {
        // Offline or the route is unavailable — nothing to warm, try again next time.
      }
    })
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "WARM_PAGES" && Array.isArray(data.urls)) {
    event.waitUntil(warmPages(data.urls));
    return;
  }

  // Sent on sign-out. Cached pages are server-rendered for one person: /pos carries that cashier's
  // branch, tenant and permission flags in the HTML. On a shared café tablet the next person to
  // sign in could otherwise be served the previous cashier's page from cache while offline. Any
  // online visit overwrites it anyway; this closes the window where it would not.
  if (data.type === "CLEAR_PAGES") {
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // writes are the offline queue's problem, not the cache's

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, Sentry etc. handle their own failures

  // Never cache the API or auth. Stale data on a till is worse than an honest error, and a cached
  // session response could show the wrong person as signed in.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.destination === "image" || request.destination === "font" || request.destination === "style") {
    event.respondWith(staleWhileRevalidate(request));
  }
});
