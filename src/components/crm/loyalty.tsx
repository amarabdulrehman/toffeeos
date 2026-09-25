"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPkr } from "@/lib/money";

export interface LoyaltyProgramDto {
  isEnabled: boolean;
  pointsPerHundredRupees: number;
  paisaPerPoint: number;
}

export function useLoyaltyProgram() {
  const [program, setProgram] = useState<LoyaltyProgramDto | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/loyalty");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setProgram(data.program);
    } catch {
      /* the scheme simply isn't shown */
    }
  }, []);
  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);
  return { program, reload: load };
}

/** The owner's switch and two numbers for the loyalty scheme, with what they mean in plain money. */
export function LoyaltySettingsCard() {
  const { program, reload } = useLoyaltyProgram();
  const [draft, setDraft] = useState<{ isEnabled: boolean; points: string; worth: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (program && !draft) {
      // Seeding the form once from the loaded programme — the effect only fires until then.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft({ isEnabled: program.isEnabled, points: String(program.pointsPerHundredRupees), worth: String(program.paisaPerPoint / 100) });
    }
  }, [program, draft]);

  if (!draft) return null;
  const points = Number(draft.points) || 0;
  const worthPaisa = Math.round((Number(draft.worth) || 0) * 100);
  // What a customer gets back on a Rs 1,000 bill, in points and in rupees — the number that tells an
  // owner whether the scheme is generous or ruinous.
  const pointsOn1000 = Math.floor((100_000 * points) / 10_000);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/loyalty", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: draft!.isEnabled, pointsPerHundredRupees: points, paisaPerPoint: worthPaisa }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not save.");
      return;
    }
    toast.success(draft!.isEnabled ? "Loyalty points are on." : "Loyalty points are off.");
    await reload();
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 font-heading text-base">
            <Gift className="size-4" />
            Loyalty points
          </CardTitle>
          <CardDescription>Customers earn points on paid bills and spend them as money off a later one</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.isEnabled} onCheckedChange={(v) => setDraft({ ...draft, isEnabled: v })} aria-label="Loyalty points on" />
          {draft.isEnabled ? "On" : "Off"}
        </label>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="loyalty-points">Points per Rs 100</Label>
          <Input id="loyalty-points" type="number" min={0} max={100} className="w-28" value={draft.points}
            onChange={(e) => setDraft({ ...draft, points: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loyalty-worth">One point is worth (Rs)</Label>
          <Input id="loyalty-worth" type="number" min={0.01} step="any" className="w-28" value={draft.worth}
            onChange={(e) => setDraft({ ...draft, worth: e.target.value })} />
        </div>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          A Rs 1,000 bill earns {pointsOn1000} points, worth {formatPkr(pointsOn1000 * worthPaisa)} off a later bill.
        </p>
        <Button disabled={saving} onClick={save}>Save</Button>
      </CardContent>
    </Card>
  );
}

interface Movement {
  id: string;
  kind: "EARN" | "REDEEM" | "ADJUST" | "REVERSE";
  points: number;
  reason: string | null;
  createdAt: string;
}

const KIND_TEXT: Record<Movement["kind"], string> = {
  EARN: "Earned",
  REDEEM: "Spent",
  ADJUST: "Adjusted",
  REVERSE: "Given back / taken back",
};

/** A customer's points: balance, history, and — for whoever may — a manual correction. */
export function CustomerPoints({ customerId, balance, canAdjust, onChanged }: { customerId: string; balance: number; canAdjust: boolean; onChanged: () => void }) {
  const [history, setHistory] = useState<Movement[] | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}/points`);
    const data = await res.json().catch(() => ({}));
    setHistory(res.ok ? data.history : []);
  }, [customerId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function adjust() {
    const res = await fetch(`/api/customers/${customerId}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: Number(points), reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not adjust.");
      return;
    }
    toast.success(`Balance is now ${data.loyaltyPoints} points.`);
    setPoints("");
    setReason("");
    await load();
    onChanged();
  }

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Loyalty points</span>
        <span className="font-heading text-lg font-bold tabular-nums" data-testid="points-balance">{balance}</span>
      </div>
      {history && history.length > 0 && (
        <ul className="max-h-36 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
          {history.map((m) => (
            <li key={m.id} className="flex justify-between gap-2">
              <span>
                {KIND_TEXT[m.kind]}
                {m.reason ? ` · ${m.reason}` : ""} · {new Date(m.createdAt).toLocaleDateString()}
              </span>
              <span className="tabular-nums">{m.points > 0 ? `+${m.points}` : m.points}</span>
            </li>
          ))}
        </ul>
      )}
      {canAdjust && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Input type="number" className="w-24" placeholder="+/- pts" aria-label="Points to add or remove" value={points}
            onChange={(e) => setPoints(e.target.value)} />
          <Input className="min-w-0 flex-1" placeholder="Why?" aria-label="Reason for the adjustment" value={reason}
            onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!Number(points) || reason.trim().length < 3} onClick={adjust}>
            Adjust
          </Button>
        </div>
      )}
    </div>
  );
}
