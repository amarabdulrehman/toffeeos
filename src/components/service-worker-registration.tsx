"use client";

import { useEffect } from "react";

/**
 * Routes that have to survive an outage, warmed into the cache ahead of being visited.
 *
 * A page only enters the cache once it has been fetched through the worker, so without this the
 * first outage after setup hits whatever the staff had not happened to open yet — which, on a
 * tablet that gets turned on and left on /pos, is everything. /pos is the till and /kds the kitchen
 * screen; both run off IndexedDB once loaded, so they are genuinely usable with no line.
 *
 * A user without permission for one of these gets redirected, and the worker refuses to cache a
 * redirect — so warming a route someone cannot reach is a wasted request, not a wrong page.
 */
const CRITICAL_ROUTES = ["/pos", "/kds"];

/**
 * Registers public/sw.js, which is what lets the POS open with no connection. Without it the
 * offline queue is unreachable after a refresh — the orders are safely in IndexedDB, but the app
 * can't start to show them.
 *
 * Deliberately not registered in development: a service worker caching a dev build produces
 * genuinely baffling behaviour (edits that don't appear, HMR fighting the cache), and the thing
 * it's here to fix only matters in production anyway.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // After load, so registration never competes with the first paint on a slow café tablet.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then(async () => {
          const registration = await navigator.serviceWorker.ready;
          // The page that triggered registration was itself fetched before the worker existed, so
          // it is not in the cache either — warm the current path alongside the critical ones.
          const urls = Array.from(new Set([window.location.pathname, ...CRITICAL_ROUTES]));
          registration.active?.postMessage({ type: "WARM_PAGES", urls });
        })
        .catch(() => {
          // Non-fatal by design: no service worker just means no offline page-loads, which is
          // exactly where this app was before. Nothing else should break because it failed.
        });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
