"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared fallback for route-segment error.tsx files. Next.js requires error.tsx to be its own file
 * per segment (that's how it knows what tree to reset on retry/navigation), so every screen still
 * needs its own error.tsx — but they all render this instead of duplicating the boundary UI, and it
 * keeps the surrounding layout (sidebar, POS/KDS header) mounted since error.tsx only replaces its
 * own segment's content, never the parent layout that renders it.
 */
export function SectionError({
  error,
  retry,
  label,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  label: string;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { section: label } });
    console.error(`[${label}]`, error);
  }, [error, label]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div>
        <h2 className="font-heading text-base font-semibold">{label} hit a problem</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          This section failed to load. The rest of the app is unaffected — try again, or move to
          another section from the nav.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        )}
      </div>
      <Button onClick={retry} size="sm">
        Try again
      </Button>
    </div>
  );
}
