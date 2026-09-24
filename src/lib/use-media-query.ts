"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * useSyncExternalStore rather than useState + useEffect: the media query list is an external
 * store with its own change events, and reading it this way needs no setState inside an effect,
 * renders the right value on the first client render, and cannot tear between two components
 * reading the same query.
 *
 * `serverValue` is what the server renders with. Pick the layout that is safest to show for a
 * moment before hydration — for the till, that is the wide one, since it hides nothing.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}
