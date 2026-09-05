"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// The one customer-facing (unauthenticated, often on a diner's own phone at a table) boundary in
// this list — keep the copy warm and free of internal jargon like "module" or "tenant".
export default function OnlineOrderError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="font-heading text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load the menu right now. Nothing was ordered or charged — please try
          again.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center">
          <Button onClick={() => retry()}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
