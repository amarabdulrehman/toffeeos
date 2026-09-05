import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import type { DateRange } from "@/server/reports";
import type { PaymentMethodKey } from "@/lib/pricing";
import { occurrencesToGenerate, rebaseLastGeneratedFor, utcMidnight } from "@/lib/recurrence";

/**
 * The money-going-out side of the ledger. Everything here filters on `spentAt` (when the money
 * actually left) rather than `createdAt` (when someone got around to typing it in) — entering
 * January's rent in February has to land in January or the numbers are worthless.
 *
 * Category names are resolved with a client-side Map join rather than a Prisma relation, matching
 * how salesReport already joins menu items to their categories in src/server/reports.ts. Keeping
 * Expense.categoryId a bare column also means an archived (or, in some future code path, deleted)
 * category can never cascade a historical expense out of existence.
 */

// ---- Categories ----

export async function listCategories(tenantId: string, includeArchived = false) {
  const db = tenantDb(tenantId);
  return db.expenseCategory.findMany({
    where: includeArchived ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createCategory(tenantId: string, name: string) {
  const db = tenantDb(tenantId);
  return db.expenseCategory.create({ data: { tenantId, name } });
}

/** Archive, never delete — historical expenses keep pointing at this row for their category name.
 * Same reasoning (and same shape) as archiveItem in src/server/inventory.ts. */
export async function archiveCategory(tenantId: string, categoryId: string) {
  const db = tenantDb(tenantId);
  const existing = await db.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!existing) throw new HttpError(404, "Category not found.");
  return db.expenseCategory.update({ where: { id: categoryId }, data: { isActive: false } });
}

// ---- Expenses ----

export interface CreateExpenseInput {
  categoryId: string;
  spentAt: Date;
  amountPaisa: number;
  vendorName?: string;
  method?: PaymentMethodKey;
  note?: string;
}

export interface ExpenseRow {
  id: string;
  branchId: string;
  categoryId: string;
  categoryName: string;
  spentAt: Date;
  amountPaisa: number;
  vendorName: string | null;
  method: string | null;
  note: string | null;
  status: string;
  isRecurring: boolean;
}

export async function listExpenses(tenantId: string, branchIds: string[], range: DateRange): Promise<ExpenseRow[]> {
  const db = tenantDb(tenantId);
  const [expenses, categories] = await Promise.all([
    db.expense.findMany({
      where: { branchId: { in: branchIds }, spentAt: { gte: range.from, lte: range.to } },
      orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
    }),
    db.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);

  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  return expenses.map((e) => ({
    id: e.id,
    branchId: e.branchId,
    categoryId: e.categoryId,
    categoryName: nameById.get(e.categoryId) ?? "Uncategorised",
    spentAt: e.spentAt,
    amountPaisa: e.amountPaisa,
    vendorName: e.vendorName,
    method: e.method,
    note: e.note,
    status: e.status,
    isRecurring: e.recurringExpenseId !== null,
  }));
}

/**
 * `canApprove` is the caller's finance.expense.approve permission. Both seeded roles that can
 * record an expense (owner, branch_manager) also hold approve, so in practice everything lands
 * APPROVED — PENDING only appears if a custom role is granted create without approve. The rule the
 * rest of the system depends on: PENDING never counts toward a total.
 */
export async function createExpense(
  tenantId: string,
  branchId: string,
  actorId: string,
  canApprove: boolean,
  input: CreateExpenseInput
) {
  const db = tenantDb(tenantId);

  const category = await db.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new HttpError(400, "That expense category doesn't exist.");
  if (!category.isActive) throw new HttpError(400, "That expense category has been archived. Pick another one.");

  return db.expense.create({
    data: {
      tenantId,
      branchId,
      categoryId: input.categoryId,
      spentAt: input.spentAt,
      amountPaisa: input.amountPaisa,
      vendorName: input.vendorName,
      method: input.method,
      note: input.note,
      status: canApprove ? "APPROVED" : "PENDING",
      recordedById: actorId,
      approvedById: canApprove ? actorId : null,
      approvedAt: canApprove ? new Date() : null,
    },
  });
}

export interface UpdateExpenseInput {
  categoryId?: string;
  spentAt?: Date;
  amountPaisa?: number;
  vendorName?: string | null;
  method?: PaymentMethodKey | null;
  note?: string | null;
}

/** Field-level before/after for the audit log. On a financial record "the amount changed" is not
 * enough — what it changed *from* is the part an auditor needs, and after the edit the row itself
 * no longer holds it. */
function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T)[]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = before[f] instanceof Date ? (before[f] as Date).toISOString() : before[f];
    const b = after[f] instanceof Date ? (after[f] as Date).toISOString() : after[f];
    if (a !== b) changes[String(f)] = { from: a, to: b };
  }
  return changes;
}

/**
 * Partial edit. Status and the approval stamps are deliberately not editable here — those belong to
 * the (deferred) approval workflow, not to fixing a typo. `recurringExpenseId` is likewise
 * untouched, so an auto-generated row that gets corrected (one month's bill came in higher) keeps
 * its link to the template and stays marked "Auto".
 */
export async function updateExpense(
  tenantId: string,
  branchIds: string[],
  expenseId: string,
  input: UpdateExpenseInput
) {
  const db = tenantDb(tenantId);
  const existing = await db.expense.findFirst({ where: { id: expenseId, branchId: { in: branchIds } } });
  if (!existing) throw new HttpError(404, "Expense not found.");

  // Only re-validate when the category is actually changing: an expense already filed against a
  // since-archived category must stay editable (you should be able to fix its amount without being
  // forced to re-file it somewhere else).
  if (input.categoryId && input.categoryId !== existing.categoryId) {
    const category = await db.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new HttpError(400, "That expense category doesn't exist.");
    if (!category.isActive) throw new HttpError(400, "That expense category has been archived. Pick another one.");
  }

  const expense = await db.expense.update({
    where: { id: expenseId },
    data: {
      categoryId: input.categoryId,
      spentAt: input.spentAt,
      amountPaisa: input.amountPaisa,
      vendorName: input.vendorName,
      method: input.method,
      note: input.note,
    },
  });

  return {
    expense,
    changes: diffFields(existing, expense, ["categoryId", "spentAt", "amountPaisa", "vendorName", "method", "note"]),
  };
}

/** Returns the deleted row so the route can put the amount and category into the audit log — for a
 * financial record, "who deleted a PKR 40,000 rent entry" is the part worth keeping, and once the
 * row is gone the audit entry is the only remaining trace. */
export async function deleteExpense(tenantId: string, branchIds: string[], expenseId: string) {
  const db = tenantDb(tenantId);
  const existing = await db.expense.findFirst({ where: { id: expenseId, branchId: { in: branchIds } } });
  if (!existing) throw new HttpError(404, "Expense not found.");
  await db.expense.delete({ where: { id: expenseId } });
  return existing;
}

// ---- Recurring templates ----

export interface CreateRecurringInput {
  categoryId: string;
  amountPaisa: number;
  dayOfMonth: number;
  startsOn: Date;
  endsOn?: Date | null;
  vendorName?: string;
  method?: PaymentMethodKey;
  note?: string;
}

export async function listRecurring(tenantId: string, branchIds: string[]) {
  const db = tenantDb(tenantId);
  const [templates, categories] = await Promise.all([
    db.recurringExpense.findMany({
      where: { branchId: { in: branchIds } },
      orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }],
    }),
    db.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  return templates.map((t) => ({ ...t, categoryName: nameById.get(t.categoryId) ?? "Uncategorised" }));
}

export async function createRecurring(
  tenantId: string,
  branchId: string,
  actorId: string,
  input: CreateRecurringInput
) {
  const db = tenantDb(tenantId);
  const category = await db.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category?.isActive) throw new HttpError(400, "Pick an active expense category.");

  return db.recurringExpense.create({
    data: {
      tenantId,
      branchId,
      categoryId: input.categoryId,
      amountPaisa: input.amountPaisa,
      dayOfMonth: input.dayOfMonth,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      vendorName: input.vendorName,
      method: input.method,
      note: input.note,
      createdById: actorId,
    },
  });
}

export interface UpdateRecurringInput {
  categoryId?: string;
  amountPaisa?: number;
  dayOfMonth?: number;
  endsOn?: Date | null;
  vendorName?: string | null;
  method?: PaymentMethodKey | null;
  note?: string | null;
  isActive?: boolean;
}

/**
 * Partial edit of a template. `startsOn` is deliberately NOT editable: it's the historical anchor
 * the generator reasons from, and a template that began on the wrong date is better replaced than
 * retro-dated. `endsOn` is editable, since "stop this after December" is a normal thing to want.
 *
 * Two edits move `lastGeneratedFor`, because both would otherwise mis-bill:
 *
 * - **Changing the billing day** — see rebaseLastGeneratedFor. Moving the day later within a month
 *   already billed would otherwise charge that month twice.
 * - **Reactivating a stopped template** — the marker jumps to today, so billing resumes from now
 *   rather than back-filling every month it was deliberately switched off for. Someone who paused
 *   rent in June and resumes in September wants October's rent, not June's, July's and August's.
 */
export async function updateRecurring(
  tenantId: string,
  branchIds: string[],
  id: string,
  input: UpdateRecurringInput
) {
  const db = tenantDb(tenantId);
  const existing = await db.recurringExpense.findFirst({ where: { id, branchId: { in: branchIds } } });
  if (!existing) throw new HttpError(404, "Recurring expense not found.");

  if (input.categoryId && input.categoryId !== existing.categoryId) {
    const category = await db.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!category?.isActive) throw new HttpError(400, "Pick an active expense category.");
  }

  let lastGeneratedFor = existing.lastGeneratedFor;
  if (input.dayOfMonth !== undefined && input.dayOfMonth !== existing.dayOfMonth) {
    lastGeneratedFor = rebaseLastGeneratedFor(lastGeneratedFor, input.dayOfMonth);
  }
  if (input.isActive === true && !existing.isActive) {
    const today = utcMidnight(new Date());
    lastGeneratedFor = !lastGeneratedFor || today > lastGeneratedFor ? today : lastGeneratedFor;
  }

  const recurring = await db.recurringExpense.update({
    where: { id },
    data: {
      categoryId: input.categoryId,
      amountPaisa: input.amountPaisa,
      dayOfMonth: input.dayOfMonth,
      endsOn: input.endsOn,
      vendorName: input.vendorName,
      method: input.method,
      note: input.note,
      isActive: input.isActive,
      lastGeneratedFor,
    },
  });

  return {
    recurring,
    changes: diffFields(existing, recurring, [
      "categoryId",
      "amountPaisa",
      "dayOfMonth",
      "endsOn",
      "vendorName",
      "method",
      "note",
      "isActive",
      "lastGeneratedFor",
    ]),
  };
}

export async function deactivateRecurring(tenantId: string, branchIds: string[], id: string) {
  const db = tenantDb(tenantId);
  const existing = await db.recurringExpense.findFirst({ where: { id, branchId: { in: branchIds } } });
  if (!existing) throw new HttpError(404, "Recurring expense not found.");
  return db.recurringExpense.update({ where: { id }, data: { isActive: false } });
}

// ---- Recurring generation ----

/**
 * Turns every active template's outstanding occurrences into real Expense rows. Called per tenant
 * from the daily cron (src/app/api/cron/daily-summary/route.ts) — deliberately not its own Vercel
 * cron entry, since Hobby caps both how many crons a project gets and how often they run, and
 * daily-summary + backup already use that budget.
 *
 * Idempotency rests on `lastGeneratedFor`: it advances to the newest generated date in the same
 * write, so a second run the same day finds nothing left to do. Generated rows are always APPROVED
 * (nobody is standing by to approve an automated rent entry) and carry `recurringExpenseId` so they
 * can be told apart from hand-entered ones in the UI.
 */
export async function materialiseRecurringExpenses(tenantId: string, today: Date): Promise<number> {
  const db = tenantDb(tenantId);
  const templates = await db.recurringExpense.findMany({ where: { isActive: true } });

  let created = 0;
  for (const template of templates) {
    const dates = occurrencesToGenerate({
      dayOfMonth: template.dayOfMonth,
      startsOn: template.startsOn,
      endsOn: template.endsOn,
      lastGeneratedFor: template.lastGeneratedFor,
      today,
    });
    if (dates.length === 0) continue;

    await db.expense.createMany({
      data: dates.map((spentAt) => ({
        tenantId,
        branchId: template.branchId,
        categoryId: template.categoryId,
        spentAt,
        amountPaisa: template.amountPaisa,
        vendorName: template.vendorName,
        method: template.method,
        note: template.note,
        status: "APPROVED" as const,
        recordedById: template.createdById,
        approvedById: template.createdById,
        approvedAt: new Date(),
        recurringExpenseId: template.id,
      })),
    });
    await db.recurringExpense.update({
      where: { id: template.id },
      data: { lastGeneratedFor: dates[dates.length - 1] },
    });
    created += dates.length;
  }
  return created;
}
