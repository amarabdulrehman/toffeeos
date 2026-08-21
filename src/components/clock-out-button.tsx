"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Clock-in happens automatically on PIN login (src/server/auth/config.ts); this is the explicit
 * counterpart. Safe to press speculatively — clocking out when not clocked in anywhere is a no-op,
 * not an error. `onDark` mirrors SignOutButton's — legible on the dark navy sidebar chrome. */
export function ClockOutButton({ onDark = false }: { onDark?: boolean }) {
  const [loading, setLoading] = useState(false);

  async function clockOut() {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/clock-out", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not clock out.");
        return;
      }
      toast.success(data.record ? "Clocked out." : "You weren't clocked in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant={onDark ? "ghost" : "outline"}
      size="sm"
      className={onDark ? "w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" : "w-full"}
      disabled={loading}
      onClick={clockOut}
    >
      {loading ? "…" : "Clock out"}
    </Button>
  );
}
