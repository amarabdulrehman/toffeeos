"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Conflict {
  id: string;
  kind: "TABLE_DOUBLE_ORDER" | "STALE_ORDER_ACTION";
  tableId: string | null;
  orderId: string | null;
  conflictingOrderId: string | null;
  actionType: string | null;
  devicePayload: unknown;
  serverSnapshot: unknown;
  status: "OPEN" | "RESOLVED";
  resolutionNote: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<Conflict["kind"], string> = {
  TABLE_DOUBLE_ORDER: "Two devices started an order for the same table",
  STALE_ORDER_ACTION: "An offline action landed on an order another device already changed",
};

export function SyncConflictsView() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/sync-conflicts")
      .then((r) => r.json())
      .then((d) => setConflicts(d.conflicts ?? []));
  }, []);

  useEffect(load, [load]);

  async function resolve(id: string) {
    const note = notes[id]?.trim();
    if (!note) {
      toast.error("Add a note on what you decided before resolving.");
      return;
    }
    setResolving(id);
    try {
      const res = await fetch(`/api/sync-conflicts/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Could not resolve.");
        return;
      }
      toast.success("Marked resolved.");
      load();
    } finally {
      setResolving(null);
    }
  }

  const open = conflicts.filter((c) => c.status === "OPEN");
  const resolved = conflicts.filter((c) => c.status === "RESOLVED");

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <RefreshCw className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Sync Conflicts</h1>
          <p className="text-sm text-muted-foreground">
            The offline sync engine flags these instead of guessing — two devices touched the same order or table
            while offline, or a queued action landed on an order that had already changed. Look at both sides and
            decide.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {open.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">No open conflicts.</CardContent>
          </Card>
        )}
        {open.map((c) => (
          <Card key={c.id} className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{KIND_LABEL[c.kind]}</span>
                <Badge variant="destructive">OPEN</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">What the device tried to do</div>
                  <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(c.devicePayload, null, 2)}</pre>
                </div>
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">Server state at the time</div>
                  <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(c.serverSnapshot, null, 2)}</pre>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString()}
                {c.orderId && ` · order ${c.orderId.slice(0, 12)}…`}
                {c.conflictingOrderId && ` · conflicting order ${c.conflictingOrderId.slice(0, 12)}…`}
              </div>
              <Textarea
                placeholder="What did you decide? (e.g. cancelled the duplicate order, re-took the payment manually)"
                value={notes[c.id] ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
              />
              <Button size="sm" disabled={resolving === c.id} onClick={() => resolve(c.id)}>
                {resolving === c.id ? "Resolving…" : "Mark resolved"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Recently resolved</h2>
          <div className="space-y-2">
            {resolved.slice(0, 10).map((c) => (
              <Card key={c.id} className="bg-muted/30">
                <CardContent className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>{KIND_LABEL[c.kind]}</span>
                    <Badge variant="success">RESOLVED</Badge>
                  </div>
                  {c.resolutionNote && <div className="mt-1 text-xs text-muted-foreground">{c.resolutionNote}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
