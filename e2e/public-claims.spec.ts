import { test, expect } from "@playwright/test";

/**
 * The public site claims only what ToffeeOS does.
 *
 * PRA e-IMS integration, FBR digital invoicing, Foodpanda integration and Urdu don't exist, and
 * WhatsApp messaging waits on Meta's approval — no message has ever been delivered. The homepage
 * named WhatsApp three times and said riders were "tracked" (there is no map, only proof of each
 * delivery). The plan cards promised a "floor plan" (tables are grouped by floor; there is no map
 * of the room) and listed "Multi-branch" under Starter, which allows one branch. This fails if any
 * of that comes back.
 */

const FORBIDDEN = /e-?IMS|\bFBR\b|foodpanda|\burdu\b|whatsapp/i;

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

test("the homepage claims nothing ToffeeOS doesn't do", async ({ request }) => {
  const text = visibleText(await (await request.get("/")).text());
  expect(text.match(FORBIDDEN)?.[0] ?? null, "names something ToffeeOS doesn't do").toBeNull();
  expect(text, "riders aren't tracked on a map").not.toMatch(/riders?[^.]{0,40}tracked/i);
  expect(text, "there's no floor plan to arrange tables on").not.toMatch(/floor ?plan/i);
  // Still says what it does do.
  expect(text).toContain("every delivery proved with a photo or a code");
});

test("each plan card states the branch count the app enforces", async ({ page }) => {
  await page.goto("/");
  const plans = page.locator("#plans");
  await expect(plans).toContainText("Tables, grouped by floor");
  // Plan.maxBranches (TIER_MAX_BRANCHES): Starter 1, Growth 3, Complete no limit.
  for (const line of ["One branch", "Up to 3 branches", "Any number of branches"]) {
    await expect(plans).toContainText(line);
  }
  await expect(plans, "Starter is one branch").not.toContainText(/multi-branch/i);
});
