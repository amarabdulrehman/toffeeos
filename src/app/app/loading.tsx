import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a back-office page's server render is in flight.
 *
 * Every screen under /app is dynamic and DB-backed, and there was no loading boundary at all — so
 * navigating meant the router held the previous page on screen, unchanged, until the server
 * answered. On a fast connection that is a blink. On the connections this product is built for it
 * is several seconds of a tap that appears to have done nothing, which is how staff end up
 * pressing a nav item three times.
 *
 * Because this sits beside the layout rather than inside the page, the sidebar and header stay put
 * and only the content region swaps — the navigation reads as instant even when the data is not.
 *
 * Deliberately generic: one shell that suits a heading plus a table or a set of cards, which is
 * every screen here. Per-page skeletons that mimic each layout exactly are a maintenance tax that
 * comes due every time a screen changes, and the difference is invisible at the duration these are
 * on screen.
 */
export default function AppLoading() {
  return (
    <div className="p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* page heading */}
      <Skeleton className="h-7 w-52" />
      <Skeleton className="mt-2.5 h-4 w-80" />

      {/* the row of summary tiles most screens open with */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-xs">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
          </div>
        ))}
      </div>

      {/* and the table or list below them */}
      <div className="mt-6 rounded-xl border bg-card p-4 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
