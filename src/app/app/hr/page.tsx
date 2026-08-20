"use client";

import { useCallback, useEffect, useState } from "react";
import { subDays } from "date-fns";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  userName: string;
  branchName: string;
  payType: "HOURLY" | "MONTHLY";
  hoursWorked: number;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
  grossPayPaisa: number;
}

function useRange() {
  const [from, setFrom] = useState(() => subDays(new Date(), 14).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const qs = `from=${new Date(`${from}T00:00:00.000Z`).toISOString()}&to=${new Date(`${to}T23:59:59.999Z`).toISOString()}`;
  return { from, setFrom, to, setTo, qs, fromDate: from, toDate: to };
}

export default function HrPage() {
  const range = useRange();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">HR &amp; Payroll</h1>
      <p className="mb-4 text-muted-foreground">
        Clock-in reuses staff PIN login at POS. Payroll is computed live from attendance for the period below — it
        isn&apos;t saved as a standing run. Overtime isn&apos;t modeled (no policy was defined); hourly pay is rate ×
        hours worked. Disbursement (actually paying staff) stays outside the system.
      </p>

      <div className="mb-4 flex items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={range.fromDate} onChange={(e) => range.setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={range.toDate} onChange={(e) => range.setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="pay-rates">Pay rates</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
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
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const load = useCallback(() => {
    fetch(`/api/hr/shifts?${qs}`).then((r) => r.json()).then((d) => setShifts(d.shifts ?? []));
    fetch("/api/hr/pay-profiles").then((r) => r.json()).then((d) => setStaff(d.profiles ?? []));
  }, [qs]);

  useEffect(load, [load]);

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Roster</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          + Assign shift
        </Button>
      </CardHeader>
      <CardContent>
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
            {shifts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No shifts scheduled in this range.
                </TableCell>
              </TableRow>
            )}
            {shifts.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.userName}</TableCell>
                <TableCell>{new Date(s.startsAt).toLocaleString()}</TableCell>
                <TableCell>{new Date(s.endsAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => removeShift(s.id)}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
              <SelectTrigger>
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
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [clockInAt, setClockInAt] = useState("");
  const [clockOutAt, setClockOutAt] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    fetch(`/api/hr/attendance?${qs}`).then((r) => r.json()).then((d) => setRecords(d.records ?? []));
    fetch("/api/hr/pay-profiles").then((r) => r.json()).then((d) => setStaff(d.profiles ?? []));
  }, [qs]);

  useEffect(load, [load]);

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Attendance</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          + Manual entry
        </Button>
      </CardHeader>
      <CardContent>
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
            {records.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No attendance in this range.
                </TableCell>
              </TableRow>
            )}
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.userName}</TableCell>
                <TableCell>{new Date(r.clockInAt).toLocaleString()}</TableCell>
                <TableCell>{r.clockOutAt ? new Date(r.clockOutAt).toLocaleString() : <Badge variant="secondary">Still in</Badge>}</TableCell>
                <TableCell>
                  <Badge variant={r.source === "MANUAL" ? "outline" : "secondary"} title={r.editNote ?? undefined}>
                    {r.source}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual attendance entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
              <SelectTrigger>
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
  const [editing, setEditing] = useState<PayProfile | null>(null);
  const [payType, setPayType] = useState<"HOURLY" | "MONTHLY">("HOURLY");
  const [rate, setRate] = useState("");

  const load = useCallback(() => {
    fetch("/api/hr/pay-profiles").then((r) => r.json()).then((d) => setStaff(d.profiles ?? []));
  }, []);

  useEffect(load, [load]);

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
    <Card>
      <CardHeader>
        <CardTitle>Pay rates</CardTitle>
      </CardHeader>
      <CardContent>
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
                <TableCell>{s.userName}</TableCell>
                <TableCell>{s.roleName}</TableCell>
                <TableCell>{s.branchName}</TableCell>
                <TableCell>
                  {s.payType === "HOURLY"
                    ? `${formatPkr(s.hourlyRatePaisa ?? 0)}/hr`
                    : s.payType === "MONTHLY"
                      ? `${formatPkr(s.monthlySalaryPaisa ?? 0)}/mo`
                      : <Badge variant="outline">Not set</Badge>}
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
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay rate — {editing?.userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={payType} onValueChange={(v) => v && setPayType(v as "HOURLY" | "MONTHLY")}>
              <SelectTrigger>
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

function PayrollTab({ qs }: { qs: string }) {
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [payslip, setPayslip] = useState<{ userName: string; membershipId: string } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/hr/payroll?${qs}`).then((r) => r.json()).then((d) => setLines(d.lines ?? []));
  }, [qs]);

  useEffect(load, [load]);

  const totalPaisa = lines.reduce((a, l) => a + l.grossPayPaisa, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll for this period — total {formatPkr(totalPaisa)}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Pay type</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead className="text-right">Gross pay</TableHead>
              <TableHead className="text-right">Payslip</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No staff have a pay rate set yet — set one in the Pay rates tab.
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => (
              <TableRow key={l.membershipId}>
                <TableCell>{l.userName}</TableCell>
                <TableCell>{l.branchName}</TableCell>
                <TableCell>{l.payType === "HOURLY" ? `${formatPkr(l.hourlyRatePaisa ?? 0)}/hr` : `${formatPkr(l.monthlySalaryPaisa ?? 0)}/mo`}</TableCell>
                <TableCell>{l.hoursWorked}</TableCell>
                <TableCell className="text-right font-semibold">{formatPkr(l.grossPayPaisa)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setPayslip({ userName: l.userName, membershipId: l.membershipId })}>
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <PayslipDialog info={payslip} qs={qs} onClose={() => setPayslip(null)} />
    </Card>
  );
}

interface PayslipDetail {
  userName: string;
  branchName: string;
  payType: "HOURLY" | "MONTHLY";
  hoursWorked: number;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
  grossPayPaisa: number;
  attendance: { clockInAt: string; clockOutAt: string | null; hours: number }[];
}

function PayslipDialog({ info, qs, onClose }: { info: { userName: string; membershipId: string } | null; qs: string; onClose: () => void }) {
  const [detail, setDetail] = useState<PayslipDetail | null>(null);

  useEffect(() => {
    if (!info) return;
    fetch(`/api/hr/payslip/${info.membershipId}?${qs}`)
      .then((r) => r.json())
      .then(setDetail);
  }, [info, qs]);

  return (
    <Dialog open={!!info} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Payslip — {info?.userName}</DialogTitle>
        </DialogHeader>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Branch</div>
                <div className="font-medium">{detail.branchName}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Pay type</div>
                <div className="font-medium">{detail.payType === "HOURLY" ? "Hourly" : "Fixed monthly"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Hours worked</div>
                <div className="font-medium">{detail.hoursWorked}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Net pay</div>
                <div className="font-bold text-primary">{formatPkr(detail.grossPayPaisa)}</div>
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
                    <TableCell>{new Date(a.clockInAt).toLocaleString()}</TableCell>
                    <TableCell>{a.clockOutAt ? new Date(a.clockOutAt).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right">{a.hours}</TableCell>
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
