import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { SyncConflictsView } from "@/components/sync/sync-conflicts-view";

// Not tier-gated — offline-sync conflict resolution is operational hygiene, not one of the priced
// feature-grid rows, so it's available at every tier by design (see MODULE_MIN_TIER's doc comment).
export default async function SyncConflictsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("sync.conflict.resolve")) redirect("/app/dashboard");

  return <SyncConflictsView />;
}
