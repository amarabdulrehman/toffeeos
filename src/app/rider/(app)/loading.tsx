import { Skeleton } from "@/components/ui/skeleton";

/**
 * The rider's screen, while assigned orders load.
 *
 * Worth its own boundary rather than inheriting a generic one: this loads on a phone, on mobile
 * data, usually outdoors — the worst connection anyone using this product has.
 */
export default function RiderLoading() {
  return (
    <div className="min-h-svh p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your deliveries…</span>
      <Skeleton className="h-6 w-40" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
