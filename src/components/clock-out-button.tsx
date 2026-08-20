"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Clock-in happens automatically on PIN login (src/server/auth/config.ts); this is the explicit
 * counterpart. Safe to press speculatively — clocking out when not clocked in anywhere is a no-op,
 * not an error. */
export function ClockOutButton() {
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
    <Button variant="outline" size="sm" className="w-full" disabled={loading} onClick={clockOut}>
      {loading ? "…" : "Clock out"}
    </Button>
  );
}
