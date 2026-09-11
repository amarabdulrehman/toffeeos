"use client";

import { useEffect } from "react";

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
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal by design: no service worker just means no offline page-loads, which is exactly
        // where this app was before. Nothing else should break because registration failed.
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
