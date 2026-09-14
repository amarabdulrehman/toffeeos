import { Skeleton } from "@/components/ui/skeleton";

/**
 * The till, while its menu and open orders load.
 *
 * Shaped like the terminal rather than a generic panel — dark chrome across the top, the product
 * grid on the left, the order panel on the right — so the screen a cashier is about to use appears
 * to assemble rather than arrive. At the start of a shift this is the first thing they see.
 */
export default function PosLoading() {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30" aria-busy="true" aria-live="polite">
      <span className="sr-only">Opening the till…</span>

      <div className="flex items-center gap-3 bg-sidebar px-4 py-3">
        <Skeleton className="size-8 rounded-lg bg-white/10" />
        <Skeleton className="h-4 w-28 bg-white/10" />
        <Skeleton className="ml-auto h-4 w-24 bg-white/10" />
      </div>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-32" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
          <Skeleton className="mt-8 h-10 w-full rounded-lg" />
          <Skeleton className="mt-2 h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
