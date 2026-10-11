import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Phase 8 expense tracking. Everything here creates its own category/expense with a unique suffix
 * and asserts only on rows it just created — this database carries months of manual test data plus
 * whatever earlier runs left behind, so "the only expense" is never a safe assumption.
 */

test.describe("Expenses — owner happy path", () => {
  test.use({ storageState: authFile("owner") });

  test("records an expense with exact paisa math and lists it back", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Category ${uniqueSuffix()}` },
    });
    expect(catRes.ok(), await catRes.text()).toBeTruthy();
    const category = await catRes.json();

    // Rs 1,234.56 → 123456 paisa. A round number would hide a *100 rounding bug, so this
    // deliberately has non-zero paisa.
    const amountPaisa = 123_456;
    const spentAt = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 15));

    const createRes = await request.post("/api/expenses", {
      data: {
        categoryId: category.id,
        amountPaisa,
        spentAt: spentAt.toISOString(),
        vendorName: "E2E Vendor",
        method: "CASH",
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const expense = await createRes.json();

    // Owner holds finance.expense.approve, so this must land APPROVED and self-stamped — the rule
    // the totals depend on (PENDING never counts).
    expect(expense.status).toBe("APPROVED");
    expect(expense.approvedById).toBe(expense.recordedById);
    expect(expense.amountPaisa).toBe(amountPaisa);
    expect(expense.recurringExpenseId).toBeNull();

    const from = new Date(Date.UTC(spentAt.getUTCFullYear(), spentAt.getUTCMonth(), 1)).toISOString();
    const to = new Date(Date.UTC(spentAt.getUTCFullYear(), spentAt.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    const listRes = await request.get(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(listRes.ok(), await listRes.text()).toBeTruthy();
    const { expenses } = await listRes.json();

    const mine = expenses.find((e: { id: string }) => e.id === expense.id);
    expect(mine, "the expense just created should appear in its own month's range").toBeTruthy();
    expect(mine.amountPaisa).toBe(amountPaisa);
    expect(mine.categoryName).toBe(category.name);
    expect(mine.isRecurring).toBe(false);
  });

  test("filters on spentAt, not createdAt — a back-dated expense lands in the month it was spent", async ({
    request,
  }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Backdate ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    // Recorded now, but spent well in the past. This is the whole reason spentAt exists.
    const spentAt = new Date(Date.UTC(2025, 0, 15));
    const createRes = await request.post("/api/expenses", {
      data: { categoryId: category.id, amountPaisa: 50_000, spentAt: spentAt.toISOString() },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const expense = await createRes.json();

    // Present in January 2025...
    const janRes = await request.get(
      `/api/expenses?from=${encodeURIComponent(new Date(Date.UTC(2025, 0, 1)).toISOString())}&to=${encodeURIComponent(new Date(Date.UTC(2025, 0, 31, 23, 59, 59)).toISOString())}`
    );
    const janExpenses = (await janRes.json()).expenses;
    expect(janExpenses.some((e: { id: string }) => e.id === expense.id)).toBe(true);

    // ...and absent from the current month, even though that's when it was typed in.
    const now = new Date();
    const thisMonthRes = await request.get(
      `/api/expenses?from=${encodeURIComponent(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString())}&to=${encodeURIComponent(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString())}`
    );
    const thisMonth = (await thisMonthRes.json()).expenses;
    expect(thisMonth.some((e: { id: string }) => e.id === expense.id)).toBe(false);
  });

  test("spentAt round-trips exactly across a month boundary", async ({ request }) => {
    // The 1st at UTC midnight is the exact value the recurring generator emits, and the one case
    // where a timezone shift would silently move an expense into the previous month — Prisma stores
    // these in `timestamp without time zone`, so a mismatched read would show as an off-by-one-day.
    // Day-15 dates (used by the other tests here) can't catch that; only a month boundary can.
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E DateRT ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    const spentAt = new Date(Date.UTC(2026, 5, 1)).toISOString();
    const createRes = await request.post("/api/expenses", {
      data: { categoryId: category.id, amountPaisa: 1000, spentAt },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = await createRes.json();
    expect(created.spentAt.slice(0, 10)).toBe("2026-06-01");

    const from = new Date(Date.UTC(2026, 5, 1)).toISOString();
    const to = new Date(Date.UTC(2026, 5, 30, 23, 59, 59)).toISOString();
    const listRes = await request.get(
      `/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    const mine = (await listRes.json()).expenses.find((e: { id: string }) => e.id === created.id);
    expect(mine, "an expense dated the 1st must fall inside that month's range").toBeTruthy();
    expect(mine.spentAt.slice(0, 10)).toBe("2026-06-01");
  });

  test("archiving a category hides it from the picker but keeps historical expenses intact", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Archive ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    const spentAt = new Date();
    const createRes = await request.post("/api/expenses", {
      data: { categoryId: category.id, amountPaisa: 10_000, spentAt: spentAt.toISOString() },
    });
    const expense = await createRes.json();

    const archiveRes = await request.delete(`/api/expense-categories/${category.id}`);
    expect(archiveRes.ok(), await archiveRes.text()).toBeTruthy();

    // Gone from the active list the picker renders...
    const listRes = await request.get("/api/expense-categories");
    const { categories } = await listRes.json();
    expect(categories.some((c: { id: string }) => c.id === category.id)).toBe(false);

    // ...but the historical expense still resolves its name rather than showing "Uncategorised".
    const from = new Date(Date.UTC(spentAt.getUTCFullYear(), spentAt.getUTCMonth(), 1)).toISOString();
    const to = new Date(
      Date.UTC(spentAt.getUTCFullYear(), spentAt.getUTCMonth() + 1, 0, 23, 59, 59)
    ).toISOString();
    const expensesRes = await request.get(
      `/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    const mine = (await expensesRes.json()).expenses.find((e: { id: string }) => e.id === expense.id);
    expect(mine, "archiving a category must not remove its past expenses").toBeTruthy();
    expect(mine.categoryName).toBe(category.name);

    // And a new expense can no longer be filed against it.
    const rejected = await request.post("/api/expenses", {
      data: { categoryId: category.id, amountPaisa: 999, spentAt: new Date().toISOString() },
    });
    expect(rejected.status()).toBe(400);
  });

  test("rejects a nonexistent category and non-positive amounts", async ({ request }) => {
    const badCategory = await request.post("/api/expenses", {
      data: { categoryId: "not-a-real-category", amountPaisa: 1000, spentAt: new Date().toISOString() },
    });
    expect(badCategory.status()).toBe(400);

    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Validation ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    for (const amountPaisa of [0, -500]) {
      const res = await request.post("/api/expenses", {
        data: { categoryId: category.id, amountPaisa, spentAt: new Date().toISOString() },
      });
      expect(res.status(), `amountPaisa ${amountPaisa} must be rejected`).toBe(400);
    }
  });

  test("deletes an expense and it leaves the log", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Delete ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    const spentAt = new Date();
    const createRes = await request.post("/api/expenses", {
      data: { categoryId: category.id, amountPaisa: 7_500, spentAt: spentAt.toISOString() },
    });
    const expense = await createRes.json();

    const delRes = await request.delete(`/api/expenses/${expense.id}`);
    expect(delRes.ok(), await delRes.text()).toBeTruthy();

    // Unlike categories and inventory items, expenses hard-delete — a second attempt must 404.
    const secondDelete = await request.delete(`/api/expenses/${expense.id}`);
    expect(secondDelete.status()).toBe(404);
  });

  test("rejects a recurring template with dayOfMonth outside 1-28", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Recurring Validation ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    // 29-31 are rejected on purpose: the generator relies on every month having the chosen day.
    for (const dayOfMonth of [0, 29, 31]) {
      const res = await request.post("/api/recurring-expenses", {
        data: {
          categoryId: category.id,
          amountPaisa: 100_000,
          dayOfMonth,
          startsOn: new Date().toISOString(),
        },
      });
      expect(res.status(), `dayOfMonth ${dayOfMonth} must be rejected`).toBe(400);
    }
  });

  test("a back-dated recurring template lists with no generated entries until the cron runs", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Recurring ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    const createRes = await request.post("/api/recurring-expenses", {
      data: {
        categoryId: category.id,
        amountPaisa: 250_000,
        dayOfMonth: 1,
        startsOn: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        vendorName: "E2E Landlord",
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const template = await createRes.json();
    expect(template.lastGeneratedFor).toBeNull();
    expect(template.isActive).toBe(true);

    const listRes = await request.get("/api/recurring-expenses");
    const { recurring } = await listRes.json();
    const mine = recurring.find((r: { id: string }) => r.id === template.id);
    expect(mine).toBeTruthy();
    expect(mine.categoryName).toBe(category.name);

    // Stopping it is a deactivation, so the row stays queryable rather than vanishing.
    const stopRes = await request.delete(`/api/recurring-expenses/${template.id}`);
    expect(stopRes.ok(), await stopRes.text()).toBeTruthy();

    const afterRes = await request.get("/api/recurring-expenses");
    const after = (await afterRes.json()).recurring.find((r: { id: string }) => r.id === template.id);
    expect(after, "a stopped template should still be listed, just inactive").toBeTruthy();
    expect(after.isActive).toBe(false);
  });
});

test.describe("Expenses — editing", () => {
  test.use({ storageState: authFile("owner") });

  test("PATCH updates only the fields sent and reports what changed", async ({ request }) => {
    const catRes = await request.post("/api/expense-categories", {
      data: { name: `E2E Edit ${uniqueSuffix()}` },
    });
    const category = await catRes.json();

    const created = await (
      await request.post("/api/expenses", {
        data: {
          categoryId: category.id,
          amountPaisa: 10_000,
          spentAt: new Date(Date.UTC(2026, 5, 10)).toISOString(),
          vendorName: "Before Vendor",
          method: "CASH",
        },
      })
    ).json();

    const patchRes = await request.patch(`/api/expenses/${created.id}`, {
      data: { amountPaisa: 25_500, vendorName: "After Vendor" },
    });
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    const { expense, changes } = await patchRes.json();

    expect(expense.amountPaisa).toBe(25_500);
    expect(expense.vendorName).toBe("After Vendor");
    // Untouched fields must survive a partial edit.
    expect(expense.categoryId).toBe(category.id);
    expect(expense.method).toBe("CASH");
    expect(expense.spentAt.slice(0, 10)).toBe("2026-06-10");

    // The change set is what lands in the audit log, so it must carry the old values.
    expect(changes.amountPaisa).toEqual({ from: 10_000, to: 25_500 });
    expect(changes.vendorName).toEqual({ from: "Before Vendor", to: "After Vendor" });
    expect(changes.method).toBeUndefined();

    await request.delete(`/api/expenses/${created.id}`);
  });

  test("an edit that changes nothing reports no changes", async ({ request }) => {
    const category = await (
      await request.post("/api/expense-categories", { data: { name: `E2E NoOp ${uniqueSuffix()}` } })
    ).json();
    const created = await (
      await request.post("/api/expenses", {
        data: { categoryId: category.id, amountPaisa: 5_000, spentAt: new Date().toISOString() },
      })
    ).json();

    const res = await request.patch(`/api/expenses/${created.id}`, { data: { amountPaisa: 5_000 } });
    expect(res.ok()).toBeTruthy();
    const { changes } = await res.json();
    expect(Object.keys(changes), "a no-op save must not claim the figures were touched").toHaveLength(0);

    await request.delete(`/api/expenses/${created.id}`);
  });

  test("clearing an optional field with null actually clears it", async ({ request }) => {
    const category = await (
      await request.post("/api/expense-categories", { data: { name: `E2E Clear ${uniqueSuffix()}` } })
    ).json();
    const created = await (
      await request.post("/api/expenses", {
        data: {
          categoryId: category.id,
          amountPaisa: 5_000,
          spentAt: new Date().toISOString(),
          vendorName: "Someone",
          note: "a note",
        },
      })
    ).json();
    expect(created.vendorName).toBe("Someone");

    const res = await request.patch(`/api/expenses/${created.id}`, {
      data: { vendorName: null, note: null },
    });
    const { expense } = await res.json();
    expect(expense.vendorName).toBeNull();
    expect(expense.note).toBeNull();

    await request.delete(`/api/expenses/${created.id}`);
  });

  test("an expense on an archived category stays editable, but can't be moved onto one", async ({ request }) => {
    const live = await (
      await request.post("/api/expense-categories", { data: { name: `E2E EditLive ${uniqueSuffix()}` } })
    ).json();
    const doomed = await (
      await request.post("/api/expense-categories", { data: { name: `E2E EditGone ${uniqueSuffix()}` } })
    ).json();

    const created = await (
      await request.post("/api/expenses", {
        data: { categoryId: doomed.id, amountPaisa: 9_000, spentAt: new Date().toISOString() },
      })
    ).json();
    await request.delete(`/api/expense-categories/${doomed.id}`); // archive it

    // Fixing the amount must still work even though its category is now archived.
    const fix = await request.patch(`/api/expenses/${created.id}`, { data: { amountPaisa: 9_500 } });
    expect(fix.status(), await fix.text()).toBe(200);
    expect((await fix.json()).expense.amountPaisa).toBe(9_500);

    // But re-filing a different expense *onto* the archived category is rejected.
    const other = await (
      await request.post("/api/expenses", {
        data: { categoryId: live.id, amountPaisa: 1_000, spentAt: new Date().toISOString() },
      })
    ).json();
    const rejected = await request.patch(`/api/expenses/${other.id}`, { data: { categoryId: doomed.id } });
    expect(rejected.status()).toBe(400);

    await request.delete(`/api/expenses/${created.id}`);
    await request.delete(`/api/expenses/${other.id}`);
  });

  test("PATCH rejects a bad amount, a bad date, and an unknown id", async ({ request }) => {
    const category = await (
      await request.post("/api/expense-categories", { data: { name: `E2E EditVal ${uniqueSuffix()}` } })
    ).json();
    const created = await (
      await request.post("/api/expenses", {
        data: { categoryId: category.id, amountPaisa: 5_000, spentAt: new Date().toISOString() },
      })
    ).json();

    expect((await request.patch(`/api/expenses/${created.id}`, { data: { amountPaisa: 0 } })).status()).toBe(400);
    expect((await request.patch(`/api/expenses/${created.id}`, { data: { amountPaisa: -1 } })).status()).toBe(400);
    expect((await request.patch(`/api/expenses/${created.id}`, { data: { spentAt: "not-a-date" } })).status()).toBe(400);
    expect((await request.patch(`/api/expenses/does-not-exist`, { data: { amountPaisa: 100 } })).status()).toBe(404);

    await request.delete(`/api/expenses/${created.id}`);
  });

  test("a recurring template can be edited, stopped, and resumed without back-filling", async ({ request }) => {
    const category = await (
      await request.post("/api/expense-categories", { data: { name: `E2E EditRec ${uniqueSuffix()}` } })
    ).json();

    const template = await (
      await request.post("/api/recurring-expenses", {
        data: {
          categoryId: category.id,
          amountPaisa: 100_000,
          dayOfMonth: 1,
          startsOn: new Date(Date.UTC(2026, 0, 1)).toISOString(),
          vendorName: "Old Landlord",
        },
      })
    ).json();

    const patched = await request.patch(`/api/recurring-expenses/${template.id}`, {
      data: { amountPaisa: 150_000, dayOfMonth: 5, vendorName: "New Landlord" },
    });
    expect(patched.ok(), await patched.text()).toBeTruthy();
    const { recurring, changes } = await patched.json();
    expect(recurring.amountPaisa).toBe(150_000);
    expect(recurring.dayOfMonth).toBe(5);
    expect(changes.amountPaisa).toEqual({ from: 100_000, to: 150_000 });

    // startsOn isn't an editable field — sending it must not move the anchor.
    const sneaky = await request.patch(`/api/recurring-expenses/${template.id}`, {
      data: { startsOn: new Date(Date.UTC(2020, 0, 1)).toISOString() },
    });
    expect(sneaky.ok()).toBeTruthy();
    expect((await sneaky.json()).recurring.startsOn.slice(0, 10)).toBe("2026-01-01");

    // Stop, then resume. Nothing was ever generated here, so the marker jumps to today rather
    // than leaving the template poised to back-fill every month since January.
    await request.delete(`/api/recurring-expenses/${template.id}`);
    const resumed = await request.patch(`/api/recurring-expenses/${template.id}`, { data: { isActive: true } });
    expect(resumed.ok(), await resumed.text()).toBeTruthy();
    const back = (await resumed.json()).recurring;
    expect(back.isActive).toBe(true);
    expect(back.lastGeneratedFor, "resuming must set the marker so it can't back-fill").not.toBeNull();
    expect(new Date(back.lastGeneratedFor).getTime()).toBeGreaterThan(Date.UTC(2026, 0, 1));

    expect(
      (await request.patch(`/api/recurring-expenses/${template.id}`, { data: { dayOfMonth: 31 } })).status()
    ).toBe(400);
  });
});

test.describe("Expenses — the actual UI", () => {
  test.use({ storageState: authFile("owner") });

  test("clearing the date filter mid-edit doesn't throw", async ({ page }) => {
    // Regression: <input type="date"> holds an empty value while someone retypes a date, and
    // `new Date("").toISOString()` throws RangeError. This crashed the tab on an ordinary keystroke.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/app/expenses");
    await page.waitForTimeout(2500);
    await page.locator("#exp-from").fill("");
    await page.waitForTimeout(1200);
    await page.locator("#exp-from").fill("2026-01-01");
    await page.waitForTimeout(1200);

    expect(errors, "clearing a date must not throw").toEqual([]);
    await expect(page.getByText("Expense log")).toBeVisible();
  });

  test("creating a category and recording an expense through the real forms", async ({ page, request }) => {
    // Every other test here posts to the API directly. This one drives the actual form controls,
    // which is the only way to catch a broken field binding between the UI and the route.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const name = `E2E FormFlow ${uniqueSuffix()}`;
    await page.goto("/app/expenses");
    await page.waitForTimeout(2500);

    await page.getByRole("tab", { name: /Categories/i }).click();
    await page.locator("#cat-name").fill(name);
    await page.getByRole("button", { name: /^Add$/ }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(name).first()).toBeVisible();

    await page.getByRole("tab", { name: /Add expense/i }).click();
    await page.waitForTimeout(500);
    await page.locator("main").getByRole("combobox").first().click();
    await page.waitForTimeout(400);
    await page.getByRole("option", { name }).click();
    // Deliberately not a round number — a *100 rounding slip would survive "1000" but not this.
    await page.locator("#exp-amount").fill("1234.56");
    await page.locator("#exp-date").fill("2026-09-15");
    await page.locator("#exp-vendor").fill("Form Vendor");
    await page.getByRole("button", { name: /Record expense/i }).click();
    await page.waitForTimeout(2500);

    expect(errors).toEqual([]);

    const from = new Date(Date.UTC(2026, 8, 1)).toISOString();
    const to = new Date(Date.UTC(2026, 8, 30, 23, 59, 59)).toISOString();
    const res = await request.get(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const mine = (await res.json()).expenses.filter((e: { categoryName: string }) => e.categoryName === name);

    expect(mine).toHaveLength(1);
    expect(mine[0].amountPaisa).toBe(123456);
    expect(mine[0].spentAt.slice(0, 10)).toBe("2026-09-15");
    expect(mine[0].vendorName).toBe("Form Vendor");

    await request.delete(`/api/expenses/${mine[0].id}`);
  });
});

test.describe("Expenses — editing through the UI", () => {
  test.use({ storageState: authFile("owner") });

  test("the edit dialog prefills, saves, and updates the row", async ({ page, request }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const name = `E2E EditUI ${uniqueSuffix()}`;
    const category = await (await request.post("/api/expense-categories", { data: { name } })).json();
    const created = await (
      await request.post("/api/expenses", {
        data: {
          categoryId: category.id,
          amountPaisa: 44_400,
          spentAt: new Date(Date.UTC(2026, 8, 12)).toISOString(),
          vendorName: "Original",
        },
      })
    ).json();

    await page.goto("/app/expenses");
    await page.waitForTimeout(2500);
    await page.locator("#exp-from").fill("2026-09-01");
    await page.locator("#exp-to").fill("2026-09-30");
    await page.waitForTimeout(2000);

    // Scoped to this test's own row by its unique category name. A bare `.first()` picks up
    // whichever other test's expense happens to sort above it — see the warning in test-data.ts.
    const row = page.locator("tr", { hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^Edit expense of/ }).click();
    await page.waitForTimeout(800);

    // Prefilled from the row, not blank.
    await expect(page.locator("#edit-amount")).toHaveValue("444.00");
    await expect(page.locator("#edit-vendor")).toHaveValue("Original");
    await expect(page.locator("#edit-date")).toHaveValue("2026-09-12");

    await page.locator("#edit-amount").fill("555.55");
    await page.locator("#edit-vendor").fill("Corrected");
    await page.getByRole("button", { name: /Save changes/i }).click();
    await page.waitForTimeout(2500);

    expect(errors).toEqual([]);

    const from = new Date(Date.UTC(2026, 8, 1)).toISOString();
    const to = new Date(Date.UTC(2026, 8, 30, 23, 59, 59)).toISOString();
    const after = (
      await (await request.get(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).json()
    ).expenses.find((e: { id: string }) => e.id === created.id);

    expect(after.amountPaisa).toBe(55_555);
    expect(after.vendorName).toBe("Corrected");

    await request.delete(`/api/expenses/${created.id}`);
  });

  test("a long category name stays inside its column instead of overflowing", async ({ page, request }) => {
    // Regression: SelectTrigger is w-fit by default, and a grid item's min-width:auto is a
    // content-based floor that even w-full can't beat — so a long category name grew the trigger
    // to ~2.5x its column and rendered on top of the Amount field. Category names are capped at
    // 60 chars, so this is well within what a real tenant can type.
    const name = `E2E Repairs & Maintenance Kitchen ${uniqueSuffix()}`;
    const category = await (await request.post("/api/expense-categories", { data: { name } })).json();
    const created = await (
      await request.post("/api/expenses", {
        data: {
          categoryId: category.id,
          amountPaisa: 425_000,
          spentAt: new Date(Date.UTC(2026, 8, 3)).toISOString(),
        },
      })
    ).json();

    await page.goto("/app/expenses");
    await page.waitForTimeout(2500);
    await page.locator("#exp-from").fill("2026-09-01");
    await page.locator("#exp-to").fill("2026-09-30");
    await page.waitForTimeout(2000);
    await page.locator("tr", { hasText: name }).getByRole("button", { name: /^Edit expense of/ }).click();
    await page.waitForTimeout(1000);

    const fits = await page.evaluate(() => {
      const trigger = document.querySelector('[data-slot="select-trigger"]') as HTMLElement;
      const cell = trigger.parentElement as HTMLElement;
      return { trigger: trigger.getBoundingClientRect().width, cell: cell.getBoundingClientRect().width };
    });
    expect(fits.trigger).toBeLessThanOrEqual(fits.cell + 1); // +1 for sub-pixel rounding

    // And the amount field it used to cover must still be readable.
    await expect(page.locator("#edit-amount")).toHaveValue("4250.00");

    await request.delete(`/api/expenses/${created.id}`);
  });
});

test.describe("Expenses — branch scoping", () => {
  test.use({ storageState: authFile("manager") });

  test("a branch manager sees only their own branch's expenses", async ({ request }) => {
    // The manager lacks orders.viewAllBranches, so resolveReportBranchIds pins them to one branch.
    // The demo tenant has two, and the owner's expenses are recorded against branch 1.
    const branchRes = await request.get("/api/branches");
    const from = new Date(Date.UTC(2024, 0, 1)).toISOString();
    const to = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)).toISOString();
    const res = await request.get(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const { expenses } = await res.json();

    // Whatever rows come back, they must all belong to a single branch — never a mix.
    const branchIds = new Set(expenses.map((e: { branchId: string }) => e.branchId));
    expect(branchIds.size, `a manager must never see more than one branch: ${[...branchIds]}`).toBeLessThanOrEqual(1);
    expect(branchRes.status()).toBeLessThan(500);
  });
});

test.describe("Expenses — permission enforcement", () => {
  test.use({ storageState: authFile("cashier") });

  test("a cashier holds no finance.* permission and is refused on every expense route", async ({ request }) => {
    const routes: { method: "get" | "post" | "delete" | "patch"; url: string; data?: unknown }[] = [
      { method: "patch", url: "/api/expenses/some-id", data: { amountPaisa: 100 } },
      { method: "patch", url: "/api/recurring-expenses/some-id", data: { amountPaisa: 100 } },
      { method: "get", url: `/api/expenses?from=${new Date(0).toISOString()}&to=${new Date().toISOString()}` },
      { method: "post", url: "/api/expenses", data: { categoryId: "x", amountPaisa: 100, spentAt: new Date().toISOString() } },
      { method: "get", url: "/api/expense-categories" },
      { method: "post", url: "/api/expense-categories", data: { name: "Should never exist" } },
      { method: "get", url: "/api/recurring-expenses" },
      { method: "delete", url: "/api/expenses/some-id" },
      { method: "delete", url: "/api/expense-categories/some-id" },
      { method: "delete", url: "/api/recurring-expenses/some-id" },
    ];

    for (const route of routes) {
      const res =
        route.method === "get"
          ? await request.get(route.url)
          : route.method === "delete"
            ? await request.delete(route.url)
            : route.method === "patch"
              ? await request.patch(route.url, { data: route.data })
              : await request.post(route.url, { data: route.data });
      // 403 specifically, not 404 — the permission check must fire before any row lookup, so a
      // cashier can't probe which ids exist.
      expect(res.status(), `${route.method.toUpperCase()} ${route.url}`).toBe(403);
    }
  });

  test("the expenses page redirects a cashier away rather than rendering", async ({ page }) => {
    await page.goto("/app/expenses");
    await expect(page).toHaveURL(/\/app\/dashboard/);
  });
});
