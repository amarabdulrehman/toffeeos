"use client";

import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  // refetchWhenOffline={false}: the session poll cannot succeed with no connection, and every
  // attempt logged a "Failed to fetch" from next-auth into the console of a till that was working
  // correctly. Nothing here gates on client session state — auth is enforced server-side on every
  // request — so skipping the poll while offline costs nothing and stops a working POS looking
  // broken to whoever is reading the console during an outage.
  return (
    <SessionProvider refetchWhenOffline={false}>
      <TooltipProvider>
        {children}
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </SessionProvider>
  );
}
