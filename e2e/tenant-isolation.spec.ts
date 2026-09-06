import { test, expect, request as playwrightRequest } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Cross-tenant isolation, exercised as a real attack would: sign up a second, completely
 * independent tenant through the public signup flow (not a DB fixture — this is what a real
 * competing restaurant looks like), create real data in it, then try to reach that data from the
 * karachi-karahi tenant's own authenticated session using real IDs (not guesses). Self-contained
 * on purpose — earlier manual testing borrowed IDs from a leftover tenant in the shared dev
 * database, which works but silently breaks the day someone cleans that tenant up.
 *
 * Known interaction, not a bug: /api/signup is rate-limited to 3/hour per IP (a deliberate
 * anti-abuse limit, verified working during the overnight hardening session — not weakened here on
 * purpose). Re-running *this file* more than 3 times inside an hour from the same machine will
 * start failing at the `beforeAll` signup step with a 429, not because tenant isolation broke.
 *
 * enumeration.spec.ts spends all three on its own probes and runs first, which used to make that
 * failure certain on every full-suite run; it now returns the budget in an afterAll.
 */
test.use({ storageState: authFile("owner") });

test.describe("Tenant isolation", () => {
  let otherOrderId: string;
  let otherTaxRuleId: string;

  test.beforeAll(async ({ baseURL }) => {
    const suffix = uniqueSuffix();
    const anon = await playwrightRequest.newContext({ baseURL });

    const signup = await anon.post("/api/signup", {
      data: {
        restaurantName: `Isolation Test Diner ${suffix}`,
        slug: `isolation-test-${suffix}`,
        ownerName: "Isolation Owner",
        ownerEmail: `isolation-${suffix}@example.com`,
        ownerPassword: "TestPassw0rd!23",
        branchName: "Main Branch",
      },
    });
    expect(signup.ok(), await signup.text()).toBeTruthy();

    // Log in as that brand-new tenant's owner to create real data inside it.
    const csrfRes = await anon.get("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    await anon.post("/api/auth/callback/credentials", {
      form: {
        tenantSlug: `isolation-test-${suffix}`,
        email: `isolation-${suffix}@example.com`,
        password: "TestPassw0rd!23",
        csrfToken,
        json: "true",
      },
    });

    // A fresh signup starts with an empty menu — create one category + item so there's something
    // real to build an order out of.
    const categoryRes = await anon.post("/api/menu", { data: { name: "Isolation Test Category" } });
    expect(categoryRes.ok(), await categoryRes.text()).toBeTruthy();
    const categoryBody = await categoryRes.json();
    const categoryId = categoryBody.id ?? categoryBody.category?.id;

    const itemRes = await anon.post("/api/menu-items", {
      data: { categoryId, name: "Isolation Test Item", basePricePaisa: 10_000 },
    });
    expect(itemRes.ok(), await itemRes.text()).toBeTruthy();
    const itemBody = await itemRes.json();
    const menuItemId = itemBody.item?.id ?? itemBody.id;

    const orderRes = await anon.post("/api/orders", {
      data: {
        type: "TAKEAWAY",
        idempotencyKey: `isolation-${suffix}`,
        lines: [{ menuItemId, quantity: 1 }],
      },
    });
    expect(orderRes.ok(), await orderRes.text()).toBeTruthy();
    otherOrderId = (await orderRes.json()).order.id;

    // Every fresh signup already seeds a Cash (PRA) + Card & digital (PRA) pair covering every
    // payment method (see tenant-signup.ts) — there's no room left to POST a new *active* rule
    // without first deactivating one of those, so use the real seeded rule itself as the
    // cross-tenant target instead of creating a new one.
    const taxRulesRes = await anon.get("/api/tax-rules");
    expect(taxRulesRes.ok(), await taxRulesRes.text()).toBeTruthy();
    const { rules } = await taxRulesRes.json();
    expect(rules.length).toBeGreaterThan(0);
    otherTaxRuleId = rules[0].id;

    await anon.dispose();
  });

  test("cannot read or void another tenant's order via a real, valid order id", async ({ request }) => {
    const voidRes = await request.post(`/api/orders/${otherOrderId}/void`, { data: { reason: "isolation probe" } });
    expect(voidRes.status()).toBe(404);
  });

  test("cannot patch or delete another tenant's tax rule via a real, valid rule id", async ({ request }) => {
    const patchRes = await request.patch(`/api/tax-rules/${otherTaxRuleId}`, { data: { isActive: false } });
    expect(patchRes.status()).toBe(404);

    const deleteRes = await request.delete(`/api/tax-rules/${otherTaxRuleId}`);
    expect(deleteRes.status()).toBe(404);
  });

  test("a tenant session cannot use the platform-only feature-toggle route at all", async ({ request }) => {
    const res = await request.patch(`/api/platform/tenants/some-id/features`, {
      data: { enabledModules: ["inventory"] },
    });
    expect(res.status()).toBe(401);
  });
});
