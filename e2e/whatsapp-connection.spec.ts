import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * WhatsApp, up to the point where only Meta is missing.
 *
 * The adapter was a stub that returned success, so every message a restaurant had ever "sent" was
 * recorded as SENT and none of them existed. That is worse than the feature being switched off: an
 * owner reading their own log has no way to tell. These tests pin the honest behaviour — nothing is
 * claimed as delivered unless a provider was actually reachable — and they run against a deployment
 * with no Meta credentials, which is exactly the state this is guarding.
 *
 * The send path itself (payload shape, timeouts, Meta's errors, the access token never reaching a
 * tenant-readable log) is pinned in tests/whatsapp-adapter.test.ts, where fetch can be controlled.
 */

async function settings(request: APIRequestContext) {
  const res = await request.get("/api/whatsapp/settings");
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

test.describe("WhatsApp connection", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("reports whether this deployment can send at all, without leaking the token", async ({ request }) => {
    const body = await settings(request);

    expect(body, "the screen cannot work this out on its own").toHaveProperty("providerConfigured");
    expect(typeof body.providerConfigured).toBe("boolean");

    // No Meta credentials in development or CI, so this must read false. If it ever reads true
    // here, the screen would be telling a restaurant its messages are going out when they are not.
    expect(body.providerConfigured, "no access token is configured for this deployment").toBe(false);

    // A boolean is the whole contract. The token itself must never cross this boundary.
    expect(JSON.stringify(body)).not.toMatch(/accessToken|WHATSAPP_ACCESS_TOKEN/i);
  });

  test("a restaurant can record its own Meta phone number", async ({ request }) => {
    const phoneNumberId = `1234${uniqueSuffix()}`;
    const saved = await request.patch("/api/whatsapp/settings", {
      data: { businessPhoneNumberId: phoneNumberId, businessAccountId: "999888777" },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();

    const after = await settings(request);
    expect(after.businessPhoneNumberId).toBe(phoneNumberId);
    expect(after.businessAccountId).toBe("999888777");

    // Clearing it is a real state, not an empty string — "connected" is decided by this being null.
    const cleared = await request.patch("/api/whatsapp/settings", {
      data: { businessPhoneNumberId: null, businessAccountId: null },
    });
    expect(cleared.ok(), await cleared.text()).toBeTruthy();
    expect((await settings(request)).businessPhoneNumberId).toBeNull();
  });

  test("an unconfigured send is recorded as skipped, never as delivered", async ({ request }) => {
    /**
     * The assertion this whole change exists for. With no Meta credentials the old adapter
     * returned ok:true and the log said SENT, so a café could read a month of delivered-looking
     * messages that had never left the building.
     *
     * Driven through the real trigger rather than the adapter, because what matters is what the
     * restaurant ends up reading in its own message log. That means building the conditions for a
     * message to genuinely be attempted — an approved template and a recipient — or the trigger
     * logs nothing at all and "no row claims delivery" is true for the wrong reason. It did
     * exactly that until this setup was added: the sabotage passed.
     */
    await request.patch("/api/whatsapp/settings", { data: { enabled: true, dailySummaryEnabled: true } });

    // Reuse an approved template if a previous run already made one. Creating unconditionally
    // fails the second time — upsertDraftTemplate refuses to redraft an APPROVED template, by
    // design — and that made this test pass a sabotage for the wrong reason: it fell over in
    // setup before it ever reached the assertion.
    const existing = ((await (await request.get("/api/whatsapp/templates")).json()).templates ?? []) as {
      id: string;
      key: string;
      status: string;
    }[];
    const approved = existing.find((t) => t.key === "daily_summary" && t.status === "APPROVED");

    if (!approved) {
      const draft = await request.post("/api/whatsapp/templates", {
        data: {
          key: "daily_summary",
          name: "Daily summary",
          bodyText: "{{1}} at {{2}}: {{3}} orders, {{4}}.",
        },
      });
      expect(draft.ok(), await draft.text()).toBeTruthy();
      const templateId = (await draft.json()).template.id;
      // DRAFT -> PENDING_APPROVAL -> APPROVED. getApprovedTemplate refuses anything less, and an
      // unapproved template would log SKIPPED_NO_TEMPLATE instead of reaching the adapter.
      expect((await request.post(`/api/whatsapp/templates/${templateId}/submit`, { data: {} })).ok()).toBeTruthy();
      expect((await request.post(`/api/whatsapp/templates/${templateId}/approve`, { data: {} })).ok()).toBeTruthy();
    }

    const recipient = await request.post("/api/whatsapp/recipients", {
      data: { label: `E2E probe ${uniqueSuffix()}`, phone: "923001234567" },
    });
    expect(recipient.ok(), await recipient.text()).toBeTruthy();
    const recipientId = (await recipient.json()).recipient.id;

    try {
      const countBefore = ((await (await request.get("/api/whatsapp/messages")).json()).messages ?? []).length;

      const fired = await request.post("/api/whatsapp/daily-summary", { data: {} });
      expect(fired.ok(), await fired.text()).toBeTruthy();

      const messages = ((await (await request.get("/api/whatsapp/messages")).json()).messages ?? []) as {
        status: string;
        error: string | null;
      }[];

      // A row must actually have been written, or nothing below proves anything.
      expect(messages.length, "the trigger should have logged a message").toBeGreaterThan(countBefore);

      const fresh = messages[0];
      expect(
        fresh.status,
        `nothing can be SENT with no provider configured: ${JSON.stringify(fresh)}`
      ).toBe("SKIPPED_NOT_CONFIGURED");
      expect(fresh.error, "and it should say why, so an owner can act on it").toBeTruthy();
    } finally {
      // Left behind, this recipient would make every later run send a real message the day
      // credentials are added.
      await request.delete(`/api/whatsapp/recipients/${recipientId}`);
    }
  });

  test("the screen says plainly that nothing is being delivered", async ({ page }) => {
    // The owner-facing half. A banner that still reads "built against a dev stub" is no use to a
    // restaurant, and one that reads "connected" would be a lie.
    await page.goto("/app/whatsapp");
    await expect(page.getByRole("heading", { name: "WhatsApp" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not connected on this deployment/i)).toBeVisible();

    // And the place they would fix it.
    await expect(page.getByLabel("Phone number ID")).toBeVisible();
    await expect(page.getByLabel("Business account ID")).toBeVisible();
  });
});
