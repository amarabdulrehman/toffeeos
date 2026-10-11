import "dotenv/config";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { TENANT_SLUG, authFile, uniqueSuffix } from "./fixtures/test-data";
import { withDb } from "./fixtures/platform-admin";

/**
 * A rider added from the Riders screen can sign in.
 *
 * They couldn't, in production. The screen took a name and a phone number, and the rider page
 * offered only a texted code, which production can't send: there is no SMS sender. So every rider
 * added there had no way in. The screen now issues a password, shown once to the manager, and the
 * rider page signs in with restaurant, phone and password.
 *
 * Reset and deactivation have to end the rider's session, not only the next sign-in: a rider who
 * leaves, or loses their phone, must be out the moment the manager acts.
 */

/** Any route behind defineHandler a rider may call. 200 = signed in, 401 = signed out. */
const PROBE = "/api/rider/orders";

function uniquePhone(): string {
  return `0399${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
}

async function addRider(page: Page, name: string, phone: string): Promise<string> {
  await page.goto("/app/delivery");
  await page.getByRole("tab", { name: "Riders" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Phone", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "Add rider" }).click();
  const password = page.getByTestId("rider-password");
  await expect(password).toBeVisible({ timeout: 20_000 });
  return (await password.textContent())!.trim();
}

async function riderSignIn(browser: Browser, baseURL: string, phone: string, password: string) {
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto("/rider/login");
  await page.getByLabel("Restaurant URL").fill(TENANT_SLUG);
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return { context, page };
}

async function removeRider(phone: string) {
  await withDb(async (c) => {
    const ids = (await c.query('SELECT id FROM "User" WHERE phone = $1', [phone])).rows.map((r) => r.id);
    if (ids.length === 0) return;
    await c.query('DELETE FROM "Membership" WHERE "userId" = ANY($1)', [ids]);
    await c.query('DELETE FROM "User" WHERE id = ANY($1)', [ids]);
  });
}

test.describe("Rider sign-in", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 180_000 });

  test("a rider added on the Riders screen signs in with phone and password", async ({ page, browser, baseURL }) => {
    const phone = uniquePhone();
    const name = `E2E Rider ${uniqueSuffix()}`;
    try {
      const password = await addRider(page, name, phone);
      expect(password.length).toBeGreaterThanOrEqual(8);

      // Typed the way people actually type it: with the country code and spaces.
      const typed = `+92 ${phone.slice(1, 4)} ${phone.slice(4)}`;
      const rider = await riderSignIn(browser, baseURL!, typed, password);
      await rider.page.waitForURL(/\/rider\/orders/, { timeout: 30_000 });
      await expect(rider.page.getByText(name)).toBeVisible();
      expect((await rider.context.request.get(PROBE)).status()).toBe(200);
      await rider.context.close();

      // A wrong password is refused, with a reason the rider can act on.
      const wrong = await riderSignIn(browser, baseURL!, phone, `${password}x`);
      await expect(wrong.page.getByText(/don't match/)).toBeVisible({ timeout: 20_000 });
      expect(wrong.page.url()).toContain("/rider/login");
      await wrong.context.close();
    } finally {
      await removeRider(phone);
    }
  });

  test("resetting a rider's password signs them out and retires the old one", async ({ page, browser, baseURL }) => {
    const phone = uniquePhone();
    const name = `E2E Rider ${uniqueSuffix()}`;
    try {
      const first = await addRider(page, name, phone);
      const rider = await riderSignIn(browser, baseURL!, phone, first);
      await rider.page.waitForURL(/\/rider\/orders/, { timeout: 30_000 });
      expect((await rider.context.request.get(PROBE)).status()).toBe(200);

      await page.getByRole("button", { name: "Done" }).click();
      const row = page.locator("div.rounded-xl").filter({ hasText: name }).last();
      page.once("dialog", (d) => void d.accept());
      await row.getByRole("button", { name: "Reset password" }).click();
      const password = page.getByTestId("rider-password");
      await expect(password).toBeVisible({ timeout: 20_000 });
      const second = (await password.textContent())!.trim();
      expect(second).not.toBe(first);

      expect((await rider.context.request.get(PROBE)).status(), "the old session ends").toBe(401);
      await rider.context.close();

      const old = await riderSignIn(browser, baseURL!, phone, first);
      await expect(old.page.getByText(/don't match/)).toBeVisible({ timeout: 20_000 });
      await old.context.close();

      const fresh = await riderSignIn(browser, baseURL!, phone, second);
      await fresh.page.waitForURL(/\/rider\/orders/, { timeout: 30_000 });
      await fresh.context.close();
    } finally {
      await removeRider(phone);
    }
  });

  test("deactivating a rider ends the session they already have", async ({ page, browser, baseURL }) => {
    const phone = uniquePhone();
    const name = `E2E Rider ${uniqueSuffix()}`;
    try {
      const password = await addRider(page, name, phone);
      const rider = await riderSignIn(browser, baseURL!, phone, password);
      await rider.page.waitForURL(/\/rider\/orders/, { timeout: 30_000 });

      await page.getByRole("button", { name: "Done" }).click();
      const row = page.locator("div.rounded-xl").filter({ hasText: name }).last();
      await row.getByRole("button", { name: "Deactivate" }).click();
      await expect(row.getByText("Inactive")).toBeVisible({ timeout: 20_000 });

      expect((await rider.context.request.get(PROBE)).status()).toBe(401);
      await rider.context.close();

      const again = await riderSignIn(browser, baseURL!, phone, password);
      await expect(again.page.getByText(/don't match/)).toBeVisible({ timeout: 20_000 });
      await again.context.close();
    } finally {
      await removeRider(phone);
    }
  });

  test("a phone number already on the staff can't be given to a second rider", async ({ request }) => {
    const phone = uniquePhone();
    try {
      const first = await request.post("/api/riders", { data: { name: "E2E Rider A", phone } });
      expect(first.ok(), await first.text()).toBeTruthy();
      const second = await request.post("/api/riders", { data: { name: "E2E Rider B", phone: phone.replace(/^0/, "+92") } });
      expect(second.status()).toBe(409);
    } finally {
      await removeRider(phone);
      await removeRider(phone.replace(/^0/, "+92"));
    }
  });
});
