"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Wraps the platform admin panel (tenant list, tenant detail, billing, feature toggles).
export default function PlatformError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="font-heading text-lg font-semibold">This page hit an error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong loading this screen of the platform panel. No tenant data was
          changed — try again, or go back to the tenant list.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => router.push("/platform/tenants")}>
            Back to tenants
          </Button>
          <Button onClick={() => retry()}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
