import { test, expect } from "@playwright/test";

/**
 * The address an uptime monitor watches. It has to answer without a login, never be cached — a
 * cached "up" is exactly the lie a monitor exists to catch — and say nothing but up or down.
 */
test("the health check answers without a login, uncached, and gives nothing away", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(await res.json()).toEqual({ ok: true, database: "up" });
});
