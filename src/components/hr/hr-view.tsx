"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subDays } from "date-fns";
import { toast } from "sonner";
import {
  CalendarClock,
  CircleDollarSign,
  Clock,
  Lock,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatPkr } from "@/lib/money";

interface PayProfile {
  membershipId: string;
  userId: string;
  userName: string;
  branchName: string;
  roleName: string;
  payType: "HOURLY" | "MONTHLY" | null;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
}
interface Shift {
  id: string;
  userId: string;
  userName: string;
  startsAt: string;
  endsAt: string;
}
interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  clockInAt: string;
  clockOutAt: string | null;
  source: "PIN" | "MANUAL";
  editNote: string | null;
}
interface PayrollLine {
  membershipId: string;
  branchId: string;
  userName: string;
  branchName: string;
  payType: "HOURLY" | "MONTHLY";
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
  grossPayPaisa: number;
}
interface Disbursement {
  membershipId: string;
  grossPayPaisa: number;
  paidAt: string;
  method: string | null;
}

function useRange() {
  const [from, setFrom] = useState(() => subDays(new Date(), 14).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  // See reports-view.tsx's useDateRange for why this is wrapped — an incomplete/invalid
  // <input type="date"> value makes new Date(...).toISOString() throw and crash the page.
  let qs: string;
  try {
    qs = `from=${new Date(`${from}T00:00:00.000Z`).toISOString()}&to=${new Date(`${to}T23:59:59.999Z`).toISOString()}`;
  } catch {
    const now = new Date();
    qs = `from=${subDays(now, 14).toISOString()}&to=${now.toISOString()}`;
  }
  return { from, setFrom, to, setTo, qs, fromDate: from, toDate: to };
}

async function safeGet<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(url);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { data: null, error: body.error ?? "Could not load this." };
    return { data: body as T, error: null };
  } catch {
    return { data: null, error: "Could not load this." };
  }
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Lock className="size-6 text-muted-foreground/50" />
      {message}
    </div>
  );
}

export function HrView() {
  const range = useRange();

  return (
    <div className="p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Wallet className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">HR &amp; Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Clock-in reuses staff PIN login at POS. Payroll is computed live from attendance for the period below — it
            isn&apos;t saved as a standing run. Overtime is off by default — set a policy in the Payroll tab to turn it
            on. Marking a period as paid records who was actually disbursed and when; it doesn&apos;t move any money
            itself.
          </p>
        </div>
      </div>

      <div className="mt-6 mb-4 flex items-end gap-3 rounded-xl border bg-card p-3 shadow-xs">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={range.fromDate} onChange={(e) => range.setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={range.toDate} onChange={(e) => range.setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <Tabs defaultValue="roster">
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
          <TabsTrigger value="roster" className="gap-1.5"><CalendarClock className="size-3.5" />Roster</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5"><Clock className="size-3.5" />Attendance</TabsTrigger>
          <TabsTrigger value="pay-rates" className="gap-1.5"><CircleDollarSign className="size-3.5" />Pay rates</TabsTrigger>
          <TabsTrigger value="payroll" className="gap-1.5"><Wallet className="size-3.5" />Payroll</TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <RosterTab qs={range.qs} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab qs={range.qs} />
        </TabsContent>
        <TabsContent value="pay-rates" className="mt-4">
          <PayRatesTab />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          <PayrollTab qs={range.qs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RosterTab({ qs }: { qs: string }) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<PayProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [shiftsRes, staffRes] = await Promise.all([
      safeGet<{ shifts: Shift[] }>(`/api/hr/shifts?${qs}`),
      safeGet<{ profiles: PayProfile[] }>("/api/hr/pay-profiles"),
    ]);
    if (shiftsRes.error || staffRes.error) {
      setError(shiftsRes.error ?? staffRes.error);
      setLoading(false);
      return;
    }
    setError(null);
    setShifts(shiftsRes.data?.shifts ?? []);
    setStaff(staffRes.data?.profiles ?? []);
    setLoading(false);
  }, [qs]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function createShift() {
    if (!userId || !startsAt || !endsAt) return;
    const res = await fetch("/api/hr/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Could not create shift.");
      return;
    }
    setOpen(false);
    setUserId("");
    setStartsAt("");
    setEndsAt("");
    load();
  }

  async function removeShift(id: string) {
    const res = await fetch(`/api/hr/shifts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove shift.");
      return;
    }
    load();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Roster</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          + Assign shift
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <LoadError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  </TableRow>
                ))}
              {!loading && shifts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No shifts scheduled in this range.
                  </TableCell>
                </TableRow>
              )}
              {!loading && shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.userName}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(s.startsAt).toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(s.endsAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => removeShift(s.id)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">Assign shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Staff member">
                  {(v: string) => staff.find((s) => s.userId === v)?.userName ?? "Staff member"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.userId} value={s.userId}>
                    {s.userName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <Label className="text-xs">Starts</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ends</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
            <Button className="w-full" onClick={createShift}>
              Assign
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AttendanceTab({ qs }: { qs: string }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [staff, setStaff] = useState<PayProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [clockInAt, setClockInAt] = useState("");
  const [clockOutAt, setClockOutAt] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [recordsRes, staffRes] = await Promise.all([
      safeGet<{ records: AttendanceRecord[] }>(`/api/hr/attendance?${qs}`),
      safeGet<{ profiles: PayProfile[] }>("/api/hr/pay-profiles"),
    ]);
    if (recordsRes.error || staffRes.error) {
      setError(recordsRes.error ?? staffRes.error);
      setLoading(false);
      return;
    }
    setError(null);
    setRecords(recordsRes.data?.records ?? []);
    setStaff(staffRes.data?.profiles ?? []);
    setLoading(false);
  }, [qs]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function submitManual() {
    if (!userId || !clockInAt || !note.trim()) {
      toast.error("Staff, clock-in time, and a note are required.");
      return;
    }
    const res = await fetch("/api/hr/attendance/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        clockInAt: new Date(clockInAt).toISOString(),
        clockOutAt: clockOutAt ? new Date(clockOutAt).toISOString() : null,
        note,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Could not save entry.");
      return;
    }
    setOpen(false);
    setUserId("");
    setClockInAt("");
    setClockOutAt("");
    setNote("");
    load();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading">Attendance</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          + Manual entry
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <LoadError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Clock in</TableHead>
                <TableHead>Clock out</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  </TableRow>
                ))}
              {!loading && records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No attendance in this range.
                  </TableCell>
                </TableRow>
              )}
              {!loading && records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.userName}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.clockInAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {r.clockOutAt ? (
                      <span className="text-muted-foreground">{new Date(r.clockOutAt).toLocaleString()}</span>
                    ) : (
                      <Badge variant="info">Still in</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.source === "MANUAL" ? "warning" : "success"} title={r.editNote ?? undefined}>
                      {r.source === "MANUAL" ? "Manual" : "PIN"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">Manual attendance entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Staff member">
                  {(v: string) => staff.find((s) => s.userId === v)?.userName ?? "Staff member"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.userId} value={s.userId}>
                    {s.userName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <Label className="text-xs">Clock in</Label>
              <Input type="datetime-local" value={clockInAt} onChange={(e) => setClockInAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Clock out (optional)</Label>
              <Input type="datetime-local" value={clockOutAt} onChange={(e) => setClockOutAt(e.target.value)} />
            </div>
            <Input placeholder="Reason for the correction" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button className="w-full" onClick={submitManual}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PayRatesTab() {
  const [staff, setStaff] = useState<PayProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayProfile | null>(null);
  const [payType, setPayType] = useState<"HOURLY" | "MONTHLY">("HOURLY");
  const [rate, setRate] = useState("");

  const load = useCallback(async () => {
    const res = await safeGet<{ profiles: PayProfile[] }>("/api/hr/pay-profiles");
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    setStaff(res.data?.profiles ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function openEditor(s: PayProfile) {
    setEditing(s);
    setPayType(s.payType ?? "HOURLY");
    setRate(s.payType === "HOURLY" ? String((s.hourlyRatePaisa ?? 0) / 100) : String((s.monthlySalaryPaisa ?? 0) / 100));
  }

  async function save() {
    if (!editing) return;
    const paisa = Math.round(Number(rate) * 100);
    if (!paisa) {
      toast.error("Enter a rate.");
      return;
    }
    const res = await fetch("/api/hr/pay-profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        membershipId: editing.membershipId,
        payType,
        hourlyRatePaisa: payType === "HOURLY" ? paisa : undefined,
        monthlySalaryPaisa: payType === "MONTHLY" ? paisa : undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Could not save.");
      return;
    }
    setEditing(null);
    load();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Pay rates</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <LoadError message={error} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Pay</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.membershipId}>
                  <TableCell className="font-medium">{s.userName}</TableCell>
                  <TableCell className="text-muted-foreground">{s.roleName}</TableCell>
                  <TableCell className="text-muted-foreground">{s.branchName}</TableCell>
                  <TableCell className="tabular-nums">
                    {s.payType === "HOURLY" ? (
                      `${formatPkr(s.hourlyRatePaisa ?? 0)}/hr`
                    ) : s.payType === "MONTHLY" ? (
                      `${formatPkr(s.monthlySalaryPaisa ?? 0)}/mo`
                    ) : (
                      <Badge variant="warning">Not set</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openEditor(s)}>
                      Set rate
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">Pay rate — {editing?.userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={payType} onValueChange={(v) => v && setPayType(v as "HOURLY" | "MONTHLY")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === "HOURLY" ? "Hourly" : "Fixed monthly")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HOURLY">Hourly</SelectItem>
                <SelectItem value="MONTHLY">Fixed monthly</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder={payType === "HOURLY" ? "Rs per hour" : "Rs per month"}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <Button className="w-full" onClick={save}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface BranchSettingsForOvertime {
  overtimeThresholdHoursPerWeek: number | null;
  overtimeMultiplierBasisPoints: number;
}

/** Owner-configurable payroll policy — off by default (null threshold), matching this app's other
 * pricing-policy toggles (tax rules, service charge). Only ever affects HOURLY staff; see
 * computeHourlyBreakdown in src/server/hr.ts for how the threshold/multiplier are actually applied,
 * bucketed per ISO week rather than per this page's arbitrary date range. Scoped to the signed-in
 * admin's own branch, same convention as branches-view.tsx's Order settings card. */
function OvertimePolicyCard() {
  const [settings, setSettings] = useState<BranchSettingsForOvertime | null>(null);
  const [saving, setSaving] = useState(false);
  const thresholdInputRef = useRef<HTMLInputElement>(null);
  const multiplierInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/branch-settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings ?? null))
      .catch(() => toast.error("Could not load overtime settings."));
  }, []);

  useEffect(load, [load]);

  async function save(patch: Partial<BranchSettingsForOvertime>) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    setSaving(true);
    try {
      const res = await fetch("/api/branch-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        toast.error("Could not save overtime settings.");
        load();
        return;
      }
      toast.success("Overtime settings saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;
  const enabled = settings.overtimeThresholdHoursPerWeek !== null;
  const multiplierX = (settings.overtimeMultiplierBasisPoints / 10000).toFixed(2);

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Clock className="size-4" />
          </span>
          <div>
            <CardTitle className="font-heading text-base">Overtime policy</CardTitle>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? `Hours beyond ${settings.overtimeThresholdHoursPerWeek}/week pay ${multiplierX}x, hourly staff only.`
                : "Off — every hour pays the same rate."}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={saving}
          onCheckedChange={(checked) => {
            if (!checked) {
              save({ overtimeThresholdHoursPerWeek: null });
              return;
            }
            const threshold = Number(thresholdInputRef.current?.value);
            save({ overtimeThresholdHoursPerWeek: threshold > 0 ? threshold : 48 });
          }}
        />
      </CardHeader>
      {enabled && (
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ot-threshold">Threshold (hours/week)</Label>
            <Input
              id="ot-threshold"
              ref={thresholdInputRef}
              type="number"
              min={1}
              max={168}
              step={1}
              disabled={saving}
              defaultValue={settings.overtimeThresholdHoursPerWeek ?? 48}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v >= 1 && v <= 168) save({ overtimeThresholdHoursPerWeek: v });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ot-multiplier">Overtime rate multiplier (x)</Label>
            <Input
              id="ot-multiplier"
              ref={multiplierInputRef}
              type="number"
              min={1}
              max={10}
              step={0.25}
              disabled={saving}
              defaultValue={multiplierX}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v) && v >= 1 && v <= 10) save({ overtimeMultiplierBasisPoints: Math.round(v * 10000) });
              }}
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function PayrollTab({ qs }: { qs: string }) {
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payslip, setPayslip] = useState<{ userName: string; membershipId: string } | null>(null);
  const [disbursing, setDisbursing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await safeGet<{ lines: PayrollLine[]; disbursements: Disbursement[] }>(`/api/hr/payroll?${qs}`);
    if (res.error) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setError(null);
    setLines(res.data?.lines ?? []);
    setDisbursements(res.data?.disbursements ?? []);
    setLoading(false);
  }, [qs]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const totalPaisa = lines.reduce((a, l) => a + l.grossPayPaisa, 0);
  const paidByMembership = new Map(disbursements.map((d) => [d.membershipId, d]));

  async function markPaid(line: PayrollLine) {
    const params = new URLSearchParams(qs);
    const periodStart = params.get("from");
    const periodEnd = params.get("to");
    if (!periodStart || !periodEnd) return;
    setDisbursing(line.membershipId);
    try {
      const res = await fetch("/api/hr/payroll/disburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipId: line.membershipId,
          branchId: line.branchId,
          periodStart,
          periodEnd,
          regularHours: line.regularHours,
          overtimeHours: line.overtimeHours,
          grossPayPaisa: line.grossPayPaisa,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not record disbursement.");
        return;
      }
      toast.success(`Marked ${line.userName}'s pay for this period as paid.`);
      load();
    } finally {
      setDisbursing(null);
    }
  }

  return (
    <div className="space-y-4">
      <OvertimePolicyCard />
      <Card className="overflow-hidden shadow-md ring-1 ring-primary/10">
        <CardHeader className="bg-gradient-to-b from-primary/[0.06] to-transparent">
          <CardTitle className="font-heading text-base">Payroll for this period</CardTitle>
          <div className="font-heading text-2xl font-bold tabular-nums text-primary">{formatPkr(totalPaisa)}</div>
        </CardHeader>
        <CardContent>
          {error ? (
            <LoadError message={error} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Pay type</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead className="text-right">Gross pay</TableHead>
                  <TableHead className="text-right">Payslip</TableHead>
                  <TableHead className="text-right">Disbursement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    </TableRow>
                  ))}
                {!loading && lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No staff have a pay rate set yet — set one in the Pay rates tab.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  lines.map((l) => {
                    const paid = paidByMembership.get(l.membershipId);
                    return (
                      <TableRow key={l.membershipId}>
                        <TableCell className="font-medium">{l.userName}</TableCell>
                        <TableCell className="text-muted-foreground">{l.branchName}</TableCell>
                        <TableCell className="tabular-nums">{l.payType === "HOURLY" ? `${formatPkr(l.hourlyRatePaisa ?? 0)}/hr` : `${formatPkr(l.monthlySalaryPaisa ?? 0)}/mo`}</TableCell>
                        <TableCell className="tabular-nums">
                          {l.hoursWorked}
                          {l.overtimeHours > 0 && <span className="ml-1 text-xs text-warning">({l.overtimeHours} OT)</span>}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatPkr(l.grossPayPaisa)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setPayslip({ userName: l.userName, membershipId: l.membershipId })}>
                            View
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          {paid ? (
                            <Badge variant="success" title={new Date(paid.paidAt).toLocaleString()}>
                              Paid {formatPkr(paid.grossPayPaisa)}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={disbursing === l.membershipId}
                              onClick={() => markPaid(l)}
                            >
                              {disbursing === l.membershipId ? "Marking…" : "Mark as paid"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>

        <PayslipDialog info={payslip} qs={qs} onClose={() => setPayslip(null)} />
      </Card>
    </div>
  );
}

interface PayslipDetail {
  userName: string;
  branchName: string;
  payType: "HOURLY" | "MONTHLY";
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
  grossPayPaisa: number;
  attendance: { clockInAt: string; clockOutAt: string | null; hours: number }[];
}

function PayslipDialog({ info, qs, onClose }: { info: { userName: string; membershipId: string } | null; qs: string; onClose: () => void }) {
  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!info) return;
    (async () => {
      setDetail(null);
      setError(null);
      const res = await safeGet<PayslipDetail>(`/api/hr/payslip/${info.membershipId}?${qs}`);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDetail(res.data);
    })();
  }, [info, qs]);

  return (
    <Dialog open={!!info} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Payslip — {info?.userName}</DialogTitle>
        </DialogHeader>
        {error && <LoadError message={error} />}
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Branch</div>
                <div className="mt-0.5 font-semibold">{detail.branchName}</div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Pay type</div>
                <div className="mt-0.5 font-semibold">{detail.payType === "HOURLY" ? "Hourly" : "Fixed monthly"}</div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Hours worked</div>
                <div className="mt-0.5 font-semibold tabular-nums">
                  {detail.hoursWorked}
                  {detail.overtimeHours > 0 && (
                    <span className="ml-1 text-xs font-normal text-warning">({detail.overtimeHours} OT)</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-transparent p-3 ring-1 ring-primary/15">
                <div className="text-xs text-muted-foreground">Net pay</div>
                <div className="mt-0.5 font-heading text-lg font-bold tabular-nums text-primary">{formatPkr(detail.grossPayPaisa)}</div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clock in</TableHead>
                  <TableHead>Clock out</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.attendance.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{new Date(a.clockInAt).toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{a.clockOutAt ? new Date(a.clockOutAt).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.hours}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
