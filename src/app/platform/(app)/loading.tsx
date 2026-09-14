import { Skeleton } from "@/components/ui/skeleton";

/** Platform admin, while tenant data loads. */
export default function PlatformLoading() {
  return (
    <div className="p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-7 w-44" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg border bg-card p-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
