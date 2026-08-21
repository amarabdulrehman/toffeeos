"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { conflictCount, pendingCount } from "./db";
import { replayQueue } from "./queue";

// navigator.onLine only reflects link-layer connectivity (e.g. still "online" on wifi with no
// internet) — it's a useful hint for "definitely offline," not a guarantee of "definitely online."
// The periodic retry below is what actually catches "online per the browser, but requests keep
// failing," not just the `online` event.
const RETRY_INTERVAL_MS = 15_000;

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pending: number;
  conflicts: number;
}

export function useSync(): SyncState {
  // Deliberately NOT derived from navigator.onLine here — that read has to happen client-only
  // (see the effect below), because this Next.js SSR runtime polyfills a bare `navigator` global
  // server-side too (no `.onLine`), so a `typeof navigator === "undefined"` guard in the
  // initializer doesn't actually catch it: server renders as if offline, client reads the real
  // value on first paint, and React flags a hydration mismatch. Starting both sides at the same
  // fixed value and correcting it in an effect (after hydration) sidesteps that entirely.
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const syncingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    const [p, c] = await Promise.all([pendingCount(), conflictCount()]);
    setPending(p);
    setConflicts(c);
  }, []);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const result = await replayQueue();
      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} order${result.synced === 1 ? "" : "s"}.`);
      }
      if (result.conflicts > 0) {
        toast.error(`${result.conflicts} action${result.conflicts === 1 ? "" : "s"} hit a sync conflict — a manager needs to resolve ${result.conflicts === 1 ? "it" : "them"}.`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} action${result.failed === 1 ? "" : "s"} failed to sync.`);
      }
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      await refreshCounts();
    }
  }, [refreshCounts]);

  useEffect(() => {
    // Wrapped in an inline async IIFE so the effect body itself never synchronously calls a
    // setState-triggering function — see https://react.dev/learn/you-might-not-need-an-effect.
    // That includes the client-only correction of the SSR-safe `true` default above: it runs
    // after hydration either way, so this can never cause a mismatch even though it flips state.
    (async () => {
      setIsOnline(navigator.onLine);
      await refreshCounts();
    })();
    const onOnline = () => {
      setIsOnline(true);
      sync();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Belt-and-suspenders: the `online` event can fire without connectivity actually being usable
    // (or not fire at all in some environments), so also just try periodically.
    const syncInterval = setInterval(() => {
      if (navigator.onLine) sync();
    }, RETRY_INTERVAL_MS);

    // The banner's pending/conflict count needs to update the moment the POS enqueues a new
    // action, not just after a sync attempt — cheap local IndexedDB reads, so a short poll is
    // fine rather than wiring a cross-component event bus for this.
    const countInterval = setInterval(refreshCounts, 2_000);

    if (navigator.onLine) sync();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(syncInterval);
      clearInterval(countInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOnline, isSyncing, pending, conflicts };
}
