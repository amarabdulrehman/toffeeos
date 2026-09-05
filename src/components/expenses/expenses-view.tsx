"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  Lock,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Tags,
  Trash2,
  Wallet,
} from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";

interface Category {
  id: string;
  name: string;
  isActive: boolean;
}
interface Expense {
  id: string;
  categoryId: string;
  categoryName: string;
  spentAt: string;
  amountPaisa: number;
  vendorName: string | null;
  method: string | null;
  note: string | null;
  status: string;
  isRecurring: boolean;
}
interface Recurring {
  id: string;
  categoryId: string;
  categoryName: string;
  amountPaisa: number;
  dayOfMonth: number;
  vendorName: string | null;
  isActive: boolean;
  startsOn: string;
  endsOn: string | null;
  lastGeneratedFor: string | null;
}

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "JAZZCASH", label: "JazzCash" },
  { value: "EASYPAISA", label: "Easypaisa" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

/** GET-only fetch that never lets a non-200 body get treated as real data — same pattern as
 * Inventory/Reports/CRM. */
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

/** yyyy-MM-dd for <input type="date">, in UTC to match how spentAt is stored and compared. */
function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The inverse, and the only way this file is allowed to read a date input. A native
 * <input type="date"> happily holds an empty or half-typed value while someone is retyping a date,
 * and `new Date("").toISOString()` throws RangeError rather than returning something harmless —
 * so an unguarded conversion blows up on an ordinary keystroke. Returns null until the value is a
 * real date. reports-view.tsx guards the same hazard inline in useDateRange.
 */
function dateInputToIso(value: string, endOfDay = false): string | null {
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The default view is the current calendar month — the period an owner actually thinks in when
 * asking "what have I spent?". */
function currentMonthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { from, to };
}

export function ExpensesView() {
  // Lazy useState initializers, so these run once on mount rather than on every render.
  const [from, setFrom] = useState(() => toDateInput(currentMonthRange().from));
  const [to, setTo] = useState(() => toDateInput(currentMonthRange().to));
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id for the expense fetch below. Changing the date range fires a new request
  // while the previous one may still be in flight, and the two can resolve out of order — the
  // slower, older response would then overwrite the newer range's rows and leave the table showing
  // data that does not match the dates on screen. Only the newest request is allowed to set state.
  // reports-view.tsx guards the same hazard with a per-effect `cancelled` flag.
  const latestExpenseRequest = useRef(0);

  const loadCategories = useCallback(async () => {
    const res = await safeGet<{ categories: Category[] }>("/api/expense-categories");
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    setCategories(res.data?.categories ?? []);
  }, []);

  const loadExpenses = useCallback(async () => {
    // The end of the chosen day, not its midnight — otherwise anything recorded "on" the end date
    // falls outside the range and the totals silently under-report.
    const fromIso = dateInputToIso(from);
    const toIso = dateInputToIso(to, true);
    // Mid-edit (a cleared or half-typed date): hold the last good result rather than throwing or
    // blanking the table. The next valid keystroke re-runs this effect.
    if (!fromIso || !toIso) return;
    const requestId = ++latestExpenseRequest.current;
    const res = await safeGet<{ expenses: Expense[] }>(
      `/api/expenses?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
    );
    if (requestId !== latestExpenseRequest.current) return; // a newer range already won
    if (res.error) {
      setError(res.error);
      return;
    }
    setExpenses(res.data?.expenses ?? []);
  }, [from, to]);

  const loadRecurring = useCallback(async () => {
    const res = await safeGet<{ recurring: Recurring[] }>("/api/recurring-expenses");
    if (res.error) return;
    setRecurring(res.data?.recurring ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      await loadCategories();
      await loadRecurring();
    })();
  }, [loadCategories, loadRecurring]);

  useEffect(() => {
    (async () => {
      await loadExpenses();
    })();
  }, [loadExpenses]);

  // PENDING expenses are deliberately excluded from every total on this screen — the same rule the
  // future P&L will follow, so the two can never disagree about what a period cost.
  const approved = useMemo(() => expenses.filter((e) => e.status === "APPROVED"), [expenses]);
  const totalPaisa = useMemo(() => approved.reduce((a, e) => a + e.amountPaisa, 0), [approved]);
  const biggestCategory = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const e of approved) byCategory.set(e.categoryName, (byCategory.get(e.categoryName) ?? 0) + e.amountPaisa);
    let best: { name: string; paisa: number } | null = null;
    for (const [name, paisa] of byCategory) if (!best || paisa > best.paisa) best = { name, paisa };
    return best;
  }, [approved]);

  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories]);

  return (
    <div className="p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Wallet className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">What the business spends — rent, utilities, supplies, and more.</p>
        </div>
      </div>

      {error ? (
        <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="pt-6">
            <LoadError message={error} />
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="log" className="mt-6">
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
            <TabsTrigger value="log" className="gap-1.5"><Receipt className="size-3.5" />Log</TabsTrigger>
            <TabsTrigger value="add" className="gap-1.5"><Plus className="size-3.5" />Add expense</TabsTrigger>
            <TabsTrigger value="recurring" className="gap-1.5"><Repeat className="size-3.5" />Recurring</TabsTrigger>
            <TabsTrigger value="categories" className="gap-1.5"><Tags className="size-3.5" />Categories</TabsTrigger>
          </TabsList>

          <TabsContent value="log" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard label="Total this period" value={formatPkr(totalPaisa)} icon={Wallet} hero />
              <StatCard label="Entries" value={approved.length} icon={Receipt} />
              {biggestCategory && (
                <StatCard
                  label={`Biggest: ${biggestCategory.name}`}
                  value={formatPkr(biggestCategory.paisa)}
                  icon={Tags}
                />
              )}
            </div>

            <Card className="shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="font-heading">Expense log</CardTitle>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="exp-from" className="text-xs">From</Label>
                    <Input id="exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="exp-to" className="text-xs">To</Label>
                    <Input id="exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ExpenseTable expenses={expenses} categories={activeCategories} onChanged={loadExpenses} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="add" className="mt-4">
            <AddExpenseForm
              categories={activeCategories}
              onCreated={async () => {
                await loadExpenses();
              }}
            />
          </TabsContent>

          <TabsContent value="recurring" className="mt-4">
            <RecurringTab
              categories={activeCategories}
              recurring={recurring}
              onChanged={loadRecurring}
            />
          </TabsContent>

          <TabsContent value="categories" className="mt-4">
            <CategoriesTab categories={categories} onChanged={loadCategories} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function ExpenseTable({
  expenses,
  categories,
  onChanged,
}: {
  expenses: Expense[];
  categories: Category[];
  onChanged: () => Promise<void>;
}) {
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/expenses/${pendingDelete.id}`, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not delete this expense.");
        return;
      }
      toast.success("Expense deleted.");
      setPendingDelete(null);
      await onChanged();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                No expenses recorded in this period.
              </TableCell>
            </TableRow>
          )}
          {expenses.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="tabular-nums">{e.spentAt.slice(0, 10)}</TableCell>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {e.categoryName}
                  {e.isRecurring && (
                    <Badge variant="secondary" className="gap-1">
                      <Repeat className="size-3" />
                      Auto
                    </Badge>
                  )}
                  {e.status === "PENDING" && <Badge variant="warning">Pending</Badge>}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{e.vendorName ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {PAYMENT_METHODS.find((m) => m.value === e.method)?.label ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">{formatPkr(e.amountPaisa)}</TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit expense of ${formatPkr(e.amountPaisa)}`}
                    onClick={() => setEditing(e)}
                  >
                    <Pencil className="size-4 text-muted-foreground" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete expense of ${formatPkr(e.amountPaisa)}`}
                    onClick={() => setPendingDelete(e)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <EditExpenseDialog
        expense={editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await onChanged();
        }}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this expense?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingDelete
              ? `${formatPkr(pendingDelete.amountPaisa)} — ${pendingDelete.categoryName}, ${pendingDelete.spentAt.slice(0, 10)}. This can't be undone.`
              : null}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Never mind
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Edit dialog for a single expense. Keyed on the expense id so React remounts it (and therefore
 * re-runs the useState initialisers) whenever a different row is opened — without the key, opening
 * a second row would show the first row's values still sitting in state.
 */
function EditExpenseDialog({
  expense,
  categories,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  if (!expense) return null;
  return (
    <EditExpenseForm
      key={expense.id}
      expense={expense}
      categories={categories}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditExpenseForm({
  expense,
  categories,
  onClose,
  onSaved,
}: {
  expense: Expense;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  // An expense filed against a since-archived category keeps that category selectable here, so
  // fixing its amount doesn't force you to re-file it somewhere else. The server allows this too.
  const options = categories.some((c) => c.id === expense.categoryId)
    ? categories
    : [...categories, { id: expense.categoryId, name: `${expense.categoryName} (archived)`, isActive: false }];

  const [categoryId, setCategoryId] = useState(expense.categoryId);
  const [amountRs, setAmountRs] = useState((expense.amountPaisa / 100).toFixed(2));
  const [spentAt, setSpentAt] = useState(expense.spentAt.slice(0, 10));
  const [vendorName, setVendorName] = useState(expense.vendorName ?? "");
  const [method, setMethod] = useState(expense.method ?? "CASH");
  const [note, setNote] = useState(expense.note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const rupees = parseFloat(amountRs);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    const spentAtIso = dateInputToIso(spentAt);
    if (!spentAtIso) {
      toast.error("Pick a valid date.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          amountPaisa: Math.round(rupees * 100),
          spentAt: spentAtIso,
          // Empty string clears the field rather than storing "", hence null not undefined.
          vendorName: vendorName.trim() || null,
          method,
          note: note.trim() || null,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not save this expense.");
        return;
      }
      toast.success("Expense updated.");
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
        </DialogHeader>

        {expense.isRecurring && (
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            This entry was generated from a recurring expense. Editing it changes only this month&apos;s
            entry — update the template on the Recurring tab to change future ones.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="Pick a category">{(v: string) => options.find((c) => c.id === v)?.name ?? "Pick a category"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-amount">Amount (Rs)</Label>
            <Input
              id="edit-amount"
              type="number"
              min="0"
              step="0.01"
              value={amountRs}
              onChange={(e) => setAmountRs(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-date">Date spent</Label>
            <Input id="edit-date" type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Paid with</Label>
            <Select value={method} onValueChange={(v) => v && setMethod(v)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue>{(v: string) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="edit-vendor">Vendor</Label>
            <Input id="edit-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="edit-note">Note</Label>
            <Textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExpenseForm({ categories, onCreated }: { categories: Category[]; onCreated: () => Promise<void> }) {
  const [categoryId, setCategoryId] = useState("");
  const [amountRs, setAmountRs] = useState("");
  const [spentAt, setSpentAt] = useState(() => toDateInput(new Date()));
  const [vendorName, setVendorName] = useState("");
  const [method, setMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const rupees = parseFloat(amountRs);
    if (!categoryId) {
      toast.error("Pick a category.");
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    const spentAtIso = dateInputToIso(spentAt);
    if (!spentAtIso) {
      toast.error("Pick a valid date.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          // Rupees→paisa happens here, once, at the boundary — everything server-side is integer
          // paisa. See src/lib/money.ts.
          amountPaisa: Math.round(rupees * 100),
          spentAt: spentAtIso,
          vendorName: vendorName.trim() || undefined,
          method,
          note: note.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not save this expense.");
        return;
      }
      toast.success("Expense recorded.");
      setAmountRs("");
      setVendorName("");
      setNote("");
      await onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Record an expense</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="Pick a category">{(v: string) => categories.find((c) => c.id === v)?.name ?? "Pick a category"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="exp-amount">Amount (Rs)</Label>
            <Input
              id="exp-amount"
              type="number"
              min="0"
              step="0.01"
              value={amountRs}
              onChange={(e) => setAmountRs(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="exp-date">Date spent</Label>
            <Input id="exp-date" type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Paid with</Label>
            <Select value={method} onValueChange={(v) => v && setMethod(v)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue>{(v: string) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="exp-vendor">Vendor (optional)</Label>
            <Input
              id="exp-vendor"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. K-Electric"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="exp-note">Note (optional)</Label>
          <Textarea id="exp-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Record expense"}
        </Button>
      </CardContent>
    </Card>
  );
}

function RecurringTab({
  categories,
  recurring,
  onChanged,
}: {
  categories: Category[];
  recurring: Recurring[];
  onChanged: () => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [amountRs, setAmountRs] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startsOn, setStartsOn] = useState(() => toDateInput(new Date()));
  const [vendorName, setVendorName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingStop, setPendingStop] = useState<Recurring | null>(null);
  const [stopping, setStopping] = useState(false);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const resume = async (r: Recurring) => {
    setResumingId(r.id);
    try {
      const res = await fetch(`/api/recurring-expenses/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not resume this recurring expense.");
        return;
      }
      toast.success("Recurring expense resumed. It will next generate on its billing day.");
      await onChanged();
    } finally {
      setResumingId(null);
    }
  };

  const submit = async () => {
    const rupees = parseFloat(amountRs);
    if (!categoryId) {
      toast.error("Pick a category.");
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    const startsOnIso = dateInputToIso(startsOn);
    if (!startsOnIso) {
      toast.error("Pick a valid start date.");
      return;
    }
    // The API caps this at 1-28; catching it here too means a typo gets a plain-English message
    // instead of a 400 rendered as a raw validation error.
    const day = Number(dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      toast.error("Day of month must be between 1 and 28.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/recurring-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          amountPaisa: Math.round(rupees * 100),
          dayOfMonth: day,
          startsOn: startsOnIso,
          vendorName: vendorName.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not save this recurring expense.");
        return;
      }
      toast.success("Recurring expense saved.");
      setAmountRs("");
      setVendorName("");
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const confirmStop = async () => {
    if (!pendingStop) return;
    setStopping(true);
    try {
      const r = await fetch(`/api/recurring-expenses/${pendingStop.id}`, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not stop this recurring expense.");
        return;
      }
      toast.success("Recurring expense stopped.");
      setPendingStop(null);
      await onChanged();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-sm transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="font-heading">Add a recurring expense</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Generated automatically each month by the nightly job. Any months between the start date and
            today are filled in on the next run, so a back-dated start date won&apos;t lose entries.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder="Pick a category">{(v: string) => categories.find((c) => c.id === v)?.name ?? "Pick a category"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-amount">Amount (Rs)</Label>
              <Input
                id="rec-amount"
                type="number"
                min="0"
                step="0.01"
                value={amountRs}
                onChange={(e) => setAmountRs(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-day">Day of month</Label>
              {/* Capped at 28 so there is no "31st in February" case to handle. */}
              <Input
                id="rec-day"
                type="number"
                min="1"
                max="28"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">1–28, so every month has this day.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-start">Starts on</Label>
              <Input id="rec-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-vendor">Vendor (optional)</Label>
              <Input
                id="rec-vendor"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. Landlord"
              />
            </div>
          </div>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add recurring expense"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-sm transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="font-heading">Scheduled</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Last generated</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recurring.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nothing scheduled yet.
                  </TableCell>
                </TableRow>
              )}
              {recurring.map((r) => (
                <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{r.categoryName}</TableCell>
                  <TableCell className="text-muted-foreground">{r.vendorName ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    <span className="flex items-center gap-1.5">
                      <CalendarClock className="size-3.5 text-muted-foreground" />
                      {r.dayOfMonth}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.lastGeneratedFor ? r.lastGeneratedFor.slice(0, 10) : "Not yet"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatPkr(r.amountPaisa)}</TableCell>
                  <TableCell>
                    {r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Stopped</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit recurring ${r.categoryName}`}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil className="size-4 text-muted-foreground" />
                      </Button>
                      {r.isActive ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Stop recurring ${r.categoryName}`}
                          onClick={() => setPendingStop(r)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      ) : (
                        // Resuming picks up from today, never back-filling the months it was off.
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resume(r)}
                          disabled={resumingId === r.id}
                        >
                          {resumingId === r.id ? "Resuming…" : "Resume"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <EditRecurringForm
          key={editing.id}
          template={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}

      <Dialog open={pendingStop !== null} onOpenChange={(o) => !o && setPendingStop(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop this recurring expense?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            No new entries will be generated. Expenses already created from it stay in the log.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStop(null)} disabled={stopping}>
              Never mind
            </Button>
            <Button variant="destructive" onClick={confirmStop} disabled={stopping}>
              {stopping ? "Stopping…" : "Stop it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Edit dialog for a recurring template. `startsOn` is intentionally absent — it's the historical
 * anchor the generator reasons from (see updateRecurring in src/server/expenses.ts). */
function EditRecurringForm({
  template,
  categories,
  onClose,
  onSaved,
}: {
  template: Recurring;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const options = categories.some((c) => c.id === template.categoryId)
    ? categories
    : [...categories, { id: template.categoryId, name: `${template.categoryName} (archived)`, isActive: false }];

  const [categoryId, setCategoryId] = useState(template.categoryId);
  const [amountRs, setAmountRs] = useState((template.amountPaisa / 100).toFixed(2));
  const [dayOfMonth, setDayOfMonth] = useState(String(template.dayOfMonth));
  const [endsOn, setEndsOn] = useState(template.endsOn ? template.endsOn.slice(0, 10) : "");
  const [vendorName, setVendorName] = useState(template.vendorName ?? "");
  const [saving, setSaving] = useState(false);

  const dayChanged = Number(dayOfMonth) !== template.dayOfMonth;

  const save = async () => {
    const rupees = parseFloat(amountRs);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    const day = Number(dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      toast.error("Day of month must be between 1 and 28.");
      return;
    }
    // Blank clears the end date; a filled one must actually parse.
    let endsOnValue: string | null = null;
    if (endsOn) {
      const iso = dateInputToIso(endsOn);
      if (!iso) {
        toast.error("Pick a valid end date.");
        return;
      }
      endsOnValue = iso;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/recurring-expenses/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          amountPaisa: Math.round(rupees * 100),
          dayOfMonth: day,
          endsOn: endsOnValue,
          vendorName: vendorName.trim() || null,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not save this recurring expense.");
        return;
      }
      toast.success("Recurring expense updated.");
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit recurring expense</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Changes apply to future entries only. Anything already generated stays in the log as it was
          — edit those individually from the Log tab.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="Pick a category">{(v: string) => options.find((c) => c.id === v)?.name ?? "Pick a category"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-rec-amount">Amount (Rs)</Label>
            <Input
              id="edit-rec-amount"
              type="number"
              min="0"
              step="0.01"
              value={amountRs}
              onChange={(e) => setAmountRs(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-rec-day">Day of month</Label>
            <Input
              id="edit-rec-day"
              type="number"
              min="1"
              max="28"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
            />
            {dayChanged && template.lastGeneratedFor && (
              <p className="text-xs text-muted-foreground">
                Takes effect next month — this month has already been generated.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-rec-ends">Ends on (optional)</Label>
            <Input id="edit-rec-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="edit-rec-vendor">Vendor</Label>
            <Input id="edit-rec-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesTab({ categories, onChanged }: { categories: Category[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Category | null>(null);
  const [archiving, setArchiving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Enter a category name.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not add this category.");
        return;
      }
      toast.success("Category added.");
      setName("");
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      const r = await fetch(`/api/expense-categories/${pendingArchive.id}`, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body.error ?? "Could not archive this category.");
        return;
      }
      toast.success("Category archived.");
      setPendingArchive(null);
      await onChanged();
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="cat-name">New category</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Equipment"
            />
          </div>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c) => (
              <TableRow key={c.id} className={c.isActive ? "" : "opacity-60"}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  {c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Archived</Badge>}
                </TableCell>
                <TableCell>
                  {c.isActive && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Archive ${c.name}`}
                      onClick={() => setPendingArchive(c)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={pendingArchive !== null} onOpenChange={(o) => !o && setPendingArchive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive &ldquo;{pendingArchive?.name}&rdquo;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It won&apos;t be offered on new expenses. Past expenses keep it and stay in the log.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingArchive(null)} disabled={archiving}>
              Never mind
            </Button>
            <Button variant="destructive" onClick={confirmArchive} disabled={archiving}>
              {archiving ? "Archiving…" : "Archive category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
