"use client";

import { useState } from "react";
import { getCsrfToken } from "next-auth/react";
import { toast } from "sonner";
import { listQueue } from "@/lib/offline/db";

/**
 * Moves this session to another branch the person belongs to. The JWT callback rebuilds the
 * session for that membership (src/server/auth/config.ts), permissions included, so nothing here
 * is trusted beyond the branch id; a branch they don't belong to simply isn't switched to.
 * Only rendered when there is more than one branch to choose from.
 */
export function BranchSwitcher({
  branches,
  currentBranchId,
}: {
  branches: { id: string; name: string }[];
  currentBranchId: string;
}) {
  const [busy, setBusy] = useState(false);

  async function switchTo(branchId: string) {
    if (branchId === currentBranchId) return;
    setBusy(true);
    try {
      // Orders taken offline sync against whichever branch the session is on when they replay, so
      // switching now would file them under the wrong branch.
      const unsynced = await listQueue().catch(() => []);
      if (unsynced.length > 0) {
        toast.error(`This device has ${unsynced.length} offline action${unsynced.length === 1 ? "" : "s"} still to sync to this branch.`, {
          description: "Let them sync (or resolve them under Sync conflicts) before switching branch.",
        });
        setBusy(false);
        return;
      }
      // The request useSession().update() would send, made directly: update() quietly does nothing
      // while a session load is already in flight, which on a slow tablet is the first few seconds.
      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csrfToken, data: { branchId } }),
      });
      const now = await res.json().catch(() => null);
      const landed: string | undefined = now?.user?.branchId;
      if (landed !== branchId) {
        toast.error("Could not switch branch. Sign in again and retry.");
        setBusy(false);
        return;
      }
      // A full load, not router.refresh(): every screen, the POS's offline cache included, reads
      // the branch from the session at load time.
      window.location.reload();
    } catch {
      toast.error("Could not switch branch — check your connection.");
      setBusy(false);
    }
  }

  return (
    <label className="block px-1 text-xs">
      <span className="text-sidebar-foreground/55">Switch branch</span>
      <select
        aria-label="Switch branch"
        className="mt-1 w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 text-sm text-sidebar-foreground disabled:opacity-60"
        value={currentBranchId}
        disabled={busy}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
