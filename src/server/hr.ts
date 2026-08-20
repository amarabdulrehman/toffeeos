import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import type { DateRange } from "@/server/reports";

// ============================================================================
// Roster
// ============================================================================

export async function createShift(tenantId: string, branchId: string, userId: string, startsAt: Date, endsAt: Date, createdById: string) {
  if (endsAt <= startsAt) throw new HttpError(400, "A shift must end after it starts.");
  const db = tenantDb(tenantId);
  return db.shift.create({ data: { tenantId, branchId, userId, startsAt, endsAt, createdById } });
}

export async function listShifts(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const shifts = await db.shift.findMany({
    where: { branchId: { in: branchIds }, startsAt: { lte: range.to }, endsAt: { gte: range.from } },
    orderBy: { startsAt: "asc" },
  });
  const userIds = [...new Set(shifts.map((s) => s.userId))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return shifts.map((s) => ({ ...s, userName: nameById.get(s.userId) ?? "Unknown" }));
}

export async function deleteShift(tenantId: string, shiftId: string) {
  const db = tenantDb(tenantId);
  await db.shift.delete({ where: { id: shiftId } });
}

// ============================================================================
// Attendance — clock-in reuses the PIN login at POS (src/server/auth/config.ts calls clockIn()
// right after a successful staff-pin authorize); clock-out and manual correction are explicit
// actions. "Still clocked in" is represented by clockOutAt being null, not a status enum.
// ============================================================================

/** Called from the staff-pin auth provider on every successful PIN login. Idempotent in effect:
 * if this user already has an open (no clockOutAt) record for this branch, does nothing rather
 * than opening a second one — a staff member re-entering their PIN mid-shift (e.g. switching back
 * from another cashier on a shared terminal) shouldn't fragment their attendance record. */
export async function clockIn(tenantId: string, branchId: string, userId: string) {
  const db = tenantDb(tenantId);
  const open = await db.attendanceRecord.findFirst({ where: { userId, branchId, clockOutAt: null } });
  if (open) return open;
  return db.attendanceRecord.create({ data: { tenantId, branchId, userId, clockInAt: new Date(), source: "PIN" } });
}

/** Closes the user's currently-open attendance record, if any — a no-op (returns null) if they
 * aren't clocked in anywhere, rather than an error, since "clock out" is safe to press speculatively. */
export async function clockOut(tenantId: string, userId: string) {
  const db = tenantDb(tenantId);
  const open = await db.attendanceRecord.findFirst({ where: { userId, clockOutAt: null }, orderBy: { clockInAt: "desc" } });
  if (!open) return null;
  return db.attendanceRecord.update({ where: { id: open.id }, data: { clockOutAt: new Date() } });
}

export interface ManualAttendanceInput {
  branchId: string;
  userId: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  note: string;
}

/** The "manual entry option for managers to correct records" — always source=MANUAL and always
 * requires a note, same "no silent corrections" principle as inventory adjustments. */
export async function recordManualAttendance(tenantId: string, editedById: string, input: ManualAttendanceInput) {
  if (!input.note.trim()) throw new HttpError(400, "A note is required for a manual attendance entry.");
  if (input.clockOutAt && input.clockOutAt <= input.clockInAt) throw new HttpError(400, "Clock-out must be after clock-in.");
  const db = tenantDb(tenantId);
  return db.attendanceRecord.create({
    data: {
      tenantId,
      branchId: input.branchId,
      userId: input.userId,
      clockInAt: input.clockInAt,
      clockOutAt: input.clockOutAt,
      source: "MANUAL",
      editedById,
      editNote: input.note,
    },
  });
}

export async function listAttendance(tenantId: string, branchIds: string[], range: DateRange) {
  const db = tenantDb(tenantId);
  const records = await db.attendanceRecord.findMany({
    where: { branchId: { in: branchIds }, clockInAt: { gte: range.from, lte: range.to } },
    orderBy: { clockInAt: "desc" },
  });
  const userIds = [...new Set(records.map((r) => r.userId))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return records.map((r) => ({ ...r, userName: nameById.get(r.userId) ?? "Unknown" }));
}

// ============================================================================
// Pay profile
// ============================================================================

export async function listStaffPayProfiles(tenantId: string, branchIds: string[]) {
  const db = tenantDb(tenantId);
  const memberships = await db.membership.findMany({
    where: { branchId: { in: branchIds }, isActive: true },
    include: { user: { select: { name: true, email: true } }, branch: { select: { name: true } }, role: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    userName: m.user.name,
    branchName: m.branch.name,
    roleName: m.role.name,
    payType: m.payType,
    hourlyRatePaisa: m.hourlyRatePaisa,
    monthlySalaryPaisa: m.monthlySalaryPaisa,
  }));
}

export interface SetPayProfileInput {
  payType: "HOURLY" | "MONTHLY";
  hourlyRatePaisa?: number;
  monthlySalaryPaisa?: number;
}

export async function setPayProfile(tenantId: string, membershipId: string, input: SetPayProfileInput) {
  if (input.payType === "HOURLY" && !input.hourlyRatePaisa) throw new HttpError(400, "An hourly rate is required.");
  if (input.payType === "MONTHLY" && !input.monthlySalaryPaisa) throw new HttpError(400, "A monthly salary is required.");
  const db = tenantDb(tenantId);
  return db.membership.update({
    where: { id: membershipId },
    data: {
      payType: input.payType,
      hourlyRatePaisa: input.payType === "HOURLY" ? input.hourlyRatePaisa : null,
      monthlySalaryPaisa: input.payType === "MONTHLY" ? input.monthlySalaryPaisa : null,
    },
  });
}

// ============================================================================
// Payroll — computed live from attendance + pay profile each time this runs, not persisted as a
// standing "payroll run" record (see the schema comment). Overtime is explicitly NOT handled: no
// defined policy was given for this build, and the brief says to flag that as a decision needed
// rather than guess at a formula — hourly pay here is rate × total hours worked, no multiplier for
// hours beyond any threshold. Monthly staff are paid their fixed salary regardless of attendance,
// the standard treatment for a salaried employee — attendance is still recorded and shown on their
// payslip for reference, it just doesn't change what they're paid.
// ============================================================================

function hoursWorked(records: { clockInAt: Date; clockOutAt: Date | null }[]): number {
  return records.reduce((total, r) => {
    if (!r.clockOutAt) return total; // still clocked in / never clocked out — doesn't count yet
    return total + (r.clockOutAt.getTime() - r.clockInAt.getTime()) / (1000 * 60 * 60);
  }, 0);
}

export interface PayrollLine {
  membershipId: string;
  userId: string;
  userName: string;
  branchName: string;
  payType: "HOURLY" | "MONTHLY";
  hoursWorked: number;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
  grossPayPaisa: number;
}

export async function runPayroll(tenantId: string, branchIds: string[], range: DateRange): Promise<PayrollLine[]> {
  const db = tenantDb(tenantId);
  const memberships = await db.membership.findMany({
    where: { branchId: { in: branchIds }, isActive: true, payType: { not: null } },
    include: { user: { select: { name: true } }, branch: { select: { name: true } } },
  });
  if (memberships.length === 0) return [];

  const userIds = memberships.map((m) => m.userId);
  const records = await db.attendanceRecord.findMany({
    where: { userId: { in: userIds }, branchId: { in: branchIds }, clockInAt: { gte: range.from, lte: range.to } },
  });
  const recordsByUser = new Map<string, typeof records>();
  for (const r of records) {
    const arr = recordsByUser.get(r.userId) ?? [];
    arr.push(r);
    recordsByUser.set(r.userId, arr);
  }

  return memberships.map((m) => {
    const hours = hoursWorked(recordsByUser.get(m.userId) ?? []);
    const grossPayPaisa =
      m.payType === "HOURLY" ? Math.round(hours * (m.hourlyRatePaisa ?? 0)) : (m.monthlySalaryPaisa ?? 0);
    return {
      membershipId: m.id,
      userId: m.userId,
      userName: m.user.name,
      branchName: m.branch.name,
      payType: m.payType as "HOURLY" | "MONTHLY",
      hoursWorked: Math.round(hours * 100) / 100,
      hourlyRatePaisa: m.hourlyRatePaisa,
      monthlySalaryPaisa: m.monthlySalaryPaisa,
      grossPayPaisa,
    };
  });
}

export interface Payslip extends PayrollLine {
  range: DateRange;
  attendance: { clockInAt: Date; clockOutAt: Date | null; hours: number }[];
}

export async function getPayslip(tenantId: string, membershipId: string, range: DateRange): Promise<Payslip> {
  const db = tenantDb(tenantId);
  const membership = await db.membership.findUniqueOrThrow({
    where: { id: membershipId },
    include: { user: { select: { name: true } }, branch: { select: { name: true } } },
  });
  if (!membership.payType) throw new HttpError(400, "This staff member has no pay profile set up yet.");

  const records = await db.attendanceRecord.findMany({
    where: { userId: membership.userId, branchId: membership.branchId, clockInAt: { gte: range.from, lte: range.to } },
    orderBy: { clockInAt: "asc" },
  });
  const hours = hoursWorked(records);
  const grossPayPaisa =
    membership.payType === "HOURLY" ? Math.round(hours * (membership.hourlyRatePaisa ?? 0)) : (membership.monthlySalaryPaisa ?? 0);

  return {
    membershipId: membership.id,
    userId: membership.userId,
    userName: membership.user.name,
    branchName: membership.branch.name,
    payType: membership.payType,
    hoursWorked: Math.round(hours * 100) / 100,
    hourlyRatePaisa: membership.hourlyRatePaisa,
    monthlySalaryPaisa: membership.monthlySalaryPaisa,
    grossPayPaisa,
    range,
    attendance: records.map((r) => ({
      clockInAt: r.clockInAt,
      clockOutAt: r.clockOutAt,
      hours: r.clockOutAt ? Math.round(((r.clockOutAt.getTime() - r.clockInAt.getTime()) / (1000 * 60 * 60)) * 100) / 100 : 0,
    })),
  };
}
