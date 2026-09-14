import { Skeleton } from "@/components/ui/skeleton";

/** The kitchen board, while tickets load. Shaped as the ticket columns it is about to fill. */
export default function KdsLoading() {
  return (
    <div className="min-h-svh bg-sidebar p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the kitchen board…</span>
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-lg bg-white/10" />
        <Skeleton className="h-4 w-36 bg-white/10" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white/[0.06] p-4">
            <Skeleton className="h-4 w-20 bg-white/10" />
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-3.5 w-full bg-white/10" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
