import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";
import { withDb } from "./fixtures/platform-admin";

/**
 * Daily Sales: today, yesterday, any day, and weekly and monthly closings.
 *
 * What matters most is that these figures are the Sales report's figures — an owner who closes the
 * day on one screen and checks the month on another must not find two different numbers. So the
 * checks below are against the Sales report itself, not against arithmetic repeated here.
 *
 * Sales are moved onto quiet days in 2024 that no other spec uses, so the before-and-after
 * comparisons are not disturbed by whatever else the demo tenant has sold today.
 */

// Karachi is UTC+5 all year round.
const QUIET_DAY = "2024-02-14";
const LUNCH = "2024-02-14T08:00:00.000Z"; // 1pm in Karachi

// A café that trades past midnight: a sale at 1:30am on the 20th is the tail of the 19th.
const LATE_NIGHT = "2024-02-19T20:30:00.000Z"; // 1:30am on 20 Feb in Karachi
const EVENING_BEFORE = "2024-02-19T08:00:00.000Z"; // 1pm on 19 Feb

interface Totals {
  orderCount: number;
  netPaisa: number;
  byPaymentMethod: { method: string; amountPaisa: number }[];
}
interface Day {
  day: string;
  totals: Totals;
  byHour: { hour: number; orderCount: number }[];
}

async function paidOrder(request: APIRequestContext, method: "CASH" | "CARD", paidAt: string) {
  const menuItemId = await getMenuItemId(request, "Fish Pakora");
  const created = await request.post("/api/orders", {
    data: { type: "TAKEAWAY", idempotencyKey: `daily-sales-${uniqueSuffix()}`, lines: [{ menuItemId, quantity: 1 }] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const order = (await created.json()).order;
  // Priced for the method, so a card sale is charged the card rate.
  const preview = await request.post(`/api/orders/${order.id}/pay-preview`, { data: { tenders: [{ method, amountPaisa: 0 }] } });
  const total = (await preview.json()).totals.totalPaisa as number;
  const paid = await request.post(`/api/orders/${order.id}/pay`, { data: { tenders: [{ method, amountPaisa: total }] } });
  expect(paid.ok(), await paid.text()).toBeTruthy();
  // There is no API for backdating a payment, rightly, so this is done in the database.
  await withDb((c) => c.query(`UPDATE "Order" SET "paidAt" = $1 WHERE id = $2`, [paidAt, order.id]));
  return { id: order.id as string, totalPaisa: total };
}

async function day(request: APIRequestContext, date: string): Promise<Day> {
  const res = await request.get(`/api/sales/day?date=${date}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

async function salesReport(request: APIRequestContext, from: string, to: string) {
  const res = await request.get(`/api/reports/sales-summary?from=${from}&to=${to}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { orderCount: number; netPaisa: number };
}

const method = (t: Totals, m: string) => t.byPaymentMethod.find((p) => p.method === m)?.amountPaisa ?? 0;

async function setDayStart(request: APIRequestContext, minutes: number) {
  const res = await request.patch("/api/branch-settings", { data: { dayStartMinutes: minutes } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("Daily Sales", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("a day's figures move by exactly what was paid, and match the Sales report", async ({ request }) => {
    const before = await day(request, QUIET_DAY);
    const card = await paidOrder(request, "CARD", LUNCH);
    const cash = await paidOrder(request, "CASH", LUNCH);
    const after = await day(request, QUIET_DAY);

    expect(after.totals.orderCount - before.totals.orderCount).toBe(2);
    expect(after.totals.netPaisa - before.totals.netPaisa).toBe(card.totalPaisa + cash.totalPaisa);
    expect(method(after.totals, "CARD") - method(before.totals, "CARD"), "card takings").toBe(card.totalPaisa);
    expect(method(after.totals, "CASH") - method(before.totals, "CASH"), "cash takings").toBe(cash.totalPaisa);
    expect(after.byHour.find((h) => h.hour === 13)?.orderCount, "both were paid at 1pm").toBeGreaterThanOrEqual(2);

    // The same day on the Sales report: the same net, the same count.
    const report = await salesReport(request, QUIET_DAY, QUIET_DAY);
    expect(after.totals.netPaisa, "Daily Sales and the Sales report disagree").toBe(report.netPaisa);
    expect(after.totals.orderCount).toBe(report.orderCount);
  });

  test("a week lists every day, and its days add up to its total and to the Sales report", async ({ request }) => {
    const from = "2024-02-12"; // a Monday
    const to = "2024-02-18";
    // A sale on each side of the week's first edge. Without these the comparison below passed with
    // its window a day too wide, because the extra day it took in had nothing on it.
    await paidOrder(request, "CASH", "2024-02-11T07:00:00.000Z"); // Sunday noon — the week before
    await paidOrder(request, "CASH", "2024-02-12T07:00:00.000Z"); // Monday noon — this week
    const res = await request.get(`/api/sales/period?from=${from}&to=${to}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const week = (await res.json()) as { totals: Totals; days: { day: string; netPaisa: number; orderCount: number }[] };

    expect(week.days.map((d) => d.day), "every day, including the ones with no sales").toEqual([
      "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-15", "2024-02-16", "2024-02-17", "2024-02-18",
    ]);
    const sum = week.days.reduce((s, d) => s + d.netPaisa, 0);
    expect(sum, "the days add up to the week").toBe(week.totals.netPaisa);

    const report = await salesReport(request, from, to);
    expect(week.totals.netPaisa, "the week matches the Sales report").toBe(report.netPaisa);
    expect(week.totals.orderCount).toBe(report.orderCount);

    // And the day inside it is the same day as when opened on its own.
    const single = await day(request, QUIET_DAY);
    expect(week.days.find((d) => d.day === QUIET_DAY)!.netPaisa).toBe(single.totals.netPaisa);

    // The week after compares itself with exactly this one — a finished period against the whole
    // of the one before, not "to the same time".
    const next = await request.get("/api/sales/period?from=2024-02-19&to=2024-02-25");
    expect(next.ok(), await next.text()).toBeTruthy();
    const { compare } = (await next.json()) as { compare: { label: string; netPaisa: number; orderCount: number } };
    expect(compare.label).toBe("the 7 days before");
    expect(compare.netPaisa, "compared with the week before it").toBe(week.totals.netPaisa);
    expect(compare.orderCount).toBe(week.totals.orderCount);
  });

  test("a sale at 1:30am belongs to the night before when the day ends at 4am", async ({ request }) => {
    await paidOrder(request, "CASH", EVENING_BEFORE);
    await paidOrder(request, "CASH", LATE_NIGHT);

    try {
      await setDayStart(request, 0);
      const midnight19 = await day(request, "2024-02-19");
      const midnight20 = await day(request, "2024-02-20");
      const lateSales = midnight20.byHour.find((h) => h.hour === 1)?.orderCount ?? 0;
      expect(lateSales, "with days ending at midnight, 1:30am is the 20th").toBeGreaterThan(0);
      expect(midnight19.byHour.find((h) => h.hour === 1), "and not the 19th").toBeUndefined();

      await setDayStart(request, 240);
      const late19 = await day(request, "2024-02-19");
      const late20 = await day(request, "2024-02-20");
      expect(late19.byHour.find((h) => h.hour === 1)?.orderCount, "ending at 4am, it is the 19th's").toBe(lateSales);
      expect(late20.byHour.find((h) => h.hour === 1), "and no longer the 20th's").toBeUndefined();
      // Listed in the order the night ran: the afternoon before the small hours.
      const hours = late19.byHour.map((h) => h.hour);
      expect(hours.indexOf(13)).toBeLessThan(hours.indexOf(1));

      // The Sales report follows the same setting, so the two still agree.
      const report = await salesReport(request, "2024-02-19", "2024-02-19");
      expect(late19.totals.netPaisa).toBe(report.netPaisa);
      expect(late19.totals.orderCount - midnight19.totals.orderCount, "the late sales moved over").toBe(lateSales);
    } finally {
      await setDayStart(request, 0);
    }
  });

  test("the WhatsApp daily summary leads with net sales, and names the refund", async ({ request }) => {
    // It quoted gross takings, so a day with a refund in it read high against Daily Sales.
    const noon = "2024-03-05T07:00:00.000Z"; // noon in Karachi, on a day no other spec uses
    const sale = await paidOrder(request, "CASH", noon);
    const refunded = 5_000;
    const refund = await request.post(`/api/orders/${sale.id}/refund`, {
      data: { amountPaisa: refunded, method: "CASH", reason: "daily summary probe" },
    });
    expect(refund.ok(), await refund.text()).toBeTruthy();

    const res = await request.post("/api/whatsapp/daily-summary", { data: { date: noon } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const results = (await res.json()).results as { branchId: string; totalPaisa: number; netPaisa: number; body: string }[];
    const mine = results.find((r) => r.totalPaisa > 0);
    expect(mine, "the branch that made the sale should have a summary").toBeTruthy();

    const report = await salesReport(request, "2024-03-05", "2024-03-05");
    expect(mine!.netPaisa, "the same net figure as the Sales report").toBe(report.netPaisa);
    expect(mine!.body).toMatch(/ net \(Rs [\d,]+ taken, Rs [\d,]+ refunded\)/);
  });

  test("an owner can pick one branch, and the branches add up to all of them", async ({ request, page }) => {
    const listed = await request.get("/api/branches");
    expect(listed.ok(), await listed.text()).toBeTruthy();
    const branches = ((await listed.json()).branches as { id: string; name: string; isActive: boolean }[]).filter((b) => b.isActive);
    test.skip(branches.length < 2, "the demo tenant needs a second branch for this");

    const net = async (query: string) => {
      const res = await request.get(`/api/sales/day?date=${QUIET_DAY}${query}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      return (await res.json()).totals.netPaisa as number;
    };
    const all = await net("");
    const perBranch = new Map<string, number>();
    for (const b of branches) perBranch.set(b.id, await net(`&branchId=${b.id}`));
    const sum = [...perBranch.values()].reduce((a, b) => a + b, 0);
    expect(sum, "each branch on its own adds up to all of them together").toBe(all);
    expect(all, "the quiet day has sales, or this proves nothing").toBeGreaterThan(0);

    // On screen. The quiet day's sales all belong to the owner's own branch, so another branch
    // shows nothing for it — which proves the figures really follow the picker, not just the label.
    const empty = branches.find((b) => perBranch.get(b.id) === 0);
    test.skip(!empty, "every branch has sales on the quiet day");

    await page.goto("/app/sales");
    const picker = page.getByRole("combobox", { name: "Branch" });
    await expect(picker).toContainText(`All ${branches.length} branches`);
    await page.getByLabel("Pick a day").fill(QUIET_DAY);

    // The headline card's figure sits straight after its "Net sales" label.
    const heroDigits = async () =>
      (await page.getByText("Net sales", { exact: true }).first().locator("xpath=following-sibling::div[1]").textContent())?.replace(/\D/g, "");
    await expect.poll(heroDigits, { timeout: 20_000 }).toBe(String(Math.round(all / 100)));

    await picker.click();
    await page.getByRole("option", { name: empty!.name }).click();
    await expect(picker).toContainText(empty!.name);
    await expect(page.getByText(new RegExp(`^${empty!.name} · each day ends at`))).toBeVisible();
    await expect.poll(heroDigits, { message: "that branch sold nothing that day", timeout: 20_000 }).toBe("0");
  });

  test("dates it cannot answer for are refused plainly", async ({ request }) => {
    expect((await request.get("/api/sales/day?date=2024-02-31")).status()).toBe(400);
    expect((await request.get("/api/sales/day?date=2999-01-01")).status()).toBe(400);
    expect((await request.get("/api/sales/period?from=2024-01-01&to=2024-12-31")).status(), "a year is a report").toBe(400);
    expect((await request.get("/api/sales/period?from=2024-02-18&to=2024-02-12")).status()).toBe(400);
  });

  test("a cashier cannot see the takings", async ({ baseURL, browser }) => {
    const cashier = await playwrightRequest.newContext({ baseURL, storageState: authFile("cashier") });
    expect((await cashier.get("/api/sales/day")).status()).toBe(403);
    expect((await cashier.get("/api/sales/period?from=2024-02-12&to=2024-02-18")).status()).toBe(403);
    await cashier.dispose();

    const context = await browser.newContext({ storageState: authFile("cashier") });
    const page = await context.newPage();
    await page.goto("/app/sales");
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await context.close();
  });

  test("the screen: today, a week, a day inside it, and the printed summary", async ({ page }) => {
    await page.goto("/app/sales");
    await expect(page.getByRole("heading", { name: "Daily Sales" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Today", pressed: true })).toBeVisible();
    await expect(page.getByText("Net sales").first()).toBeVisible({ timeout: 20_000 });

    // Pick a day, then its week — the way an owner looks around a day.
    await page.getByLabel("Pick a day").fill(QUIET_DAY);
    await expect(page.getByRole("heading", { name: /Wed 14 Feb 2024/ })).toBeVisible();
    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByRole("heading", { name: "12 – 18 Feb 2024" })).toBeVisible();
    await expect(page.getByText("Every day")).toBeVisible({ timeout: 20_000 });

    // Into a day from the week, and back out again.
    await page.getByRole("button", { name: "Open Wed 14 Feb 2024" }).click();
    await expect(page.getByRole("heading", { name: /Wed 14 Feb 2024/ })).toBeVisible();
    await page.getByRole("button", { name: "Back to 12 – 18 Feb 2024" }).click();
    await expect(page.getByText("Every day")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Open Wed 14 Feb 2024" }).click();

    await page.getByRole("button", { name: "Print day summary" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/DAY CLOSING|SALES SO FAR/)).toBeVisible();
    await expect(dialog.getByText("NET SALES")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  test("the dashboard's sales card switches period, and each shows what the reports say", async ({ page, request }) => {
    // Asked with no date, the API answers for today by the branch's own clock.
    const todayRes = await request.get("/api/sales/day");
    expect(todayRes.ok(), await todayRes.text()).toBeTruthy();
    const today = (await todayRes.json()).day as string;
    const period = async (from: string) => {
      const res = await request.get(`/api/sales/period?from=${from}&to=${today}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      return (await res.json()).totals.netPaisa as number;
    };
    const minus = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    const expected: [string, number][] = [
      ["Today", (await day(request, today)).totals.netPaisa],
      ["Yesterday", (await day(request, minus(1))).totals.netPaisa],
      ["7 days", await period(minus(6))],
      ["30 days", await period(minus(29))],
      ["This month", await period(`${today.slice(0, 7)}-01`)],
    ];

    await page.goto("/app/dashboard");
    const card = page.getByRole("group", { name: "Sales period" });
    await expect(card.getByRole("button", { name: "Today", pressed: true })).toBeVisible({ timeout: 20_000 });

    // The figure is compared as whole rupees, digits only, so the test does not depend on how
    // this machine's Node and the browser each format a number.
    const shown = page.getByTestId("sales-net");
    for (const [label, netPaisa] of expected) {
      await card.getByRole("button", { name: label }).click();
      await expect(card.getByRole("button", { name: label, pressed: true })).toBeVisible();
      await expect
        .poll(async () => (await shown.textContent())?.replace(/\D/g, ""), {
          message: `${label} should show that period's net sales`,
          timeout: 20_000,
        })
        .toBe(String(Math.round(netPaisa / 100)));
    }

    // Button-styled links present as buttons, so it is found by its words.
    await page.getByRole("main").getByText("Every detail in Daily Sales").click();
    await expect(page).toHaveURL(/\/app\/sales/);
    await expect(page.getByRole("heading", { name: "Daily Sales" })).toBeVisible();
    await expect(page.getByText("Net sales").first()).toBeVisible({ timeout: 20_000 });
  });
});
