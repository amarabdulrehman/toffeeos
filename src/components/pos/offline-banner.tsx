"use client";

import Link from "next/link";
import { CloudOff, RefreshCw, TriangleAlert, Wifi } from "lucide-react";
import type { SyncState } from "@/lib/offline/use-sync";

/** Deliberately always rendered, never a dismissible toast or a small corner icon — the brief is
 * explicit that this needs to be obvious to a cashier mid-shift, not something they can miss. */
export function OfflineBanner({ sync }: { sync: SyncState }) {
  if (sync.conflicts > 0) {
    return (
      <div className="flex items-center justify-between gap-3 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
        <span className="flex items-center gap-2">
          <TriangleAlert className="size-4" />
          {sync.conflicts} action{sync.conflicts === 1 ? "" : "s"} could not sync automatically — needs a manager.
        </span>
        <Link href="/app/sync-conflicts" className="underline underline-offset-2">
          Review
        </Link>
      </div>
    );
  }

  if (!sync.isOnline) {
    return (
      <div className="flex items-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
        <CloudOff className="size-4" />
        You&apos;re offline — orders are being saved on this device
        {sync.pending > 0 && (
          <span className="ml-1 rounded-full bg-destructive-foreground/20 px-2 py-0.5 text-xs font-semibold">
            {sync.pending} unsynced
          </span>
        )}
      </div>
    );
  }

  if (sync.pending > 0) {
    return (
      <div className="flex items-center gap-2 bg-warning/20 px-4 py-2 text-sm font-medium text-warning-foreground">
        <RefreshCw className={`size-4 ${sync.isSyncing ? "animate-spin" : ""}`} />
        {sync.isSyncing ? "Syncing…" : "Waiting to sync"}
        <span className="ml-1 rounded-full bg-warning-foreground/15 px-2 py-0.5 text-xs font-semibold">{sync.pending} pending</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-muted/50 px-4 py-1 text-xs font-medium text-muted-foreground">
      <Wifi className="size-3.5" />
      Online — all orders synced
    </div>
  );
}
