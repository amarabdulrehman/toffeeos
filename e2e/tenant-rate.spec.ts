import "dotenv/config";
import { test, expect } from "@playwright/test";
import { TENANT_SLUG } from "./fixtures/test-data";
import { platformAdmin, withDb } from "./fixtures/platform-admin";

/**
 * Per-tenant pricing from the platform admin panel.
 *
 * Every restaurant is negotiated separately, so Subscription.customMonthlyPricePaisa — not the
 * plan's per-branch formula — is what most tenants are actually billed. The route existed and was
 * audited from the start but nothing in the UI reached it, so the only way to set a fee was as a
 * side effect of recording a payment. These tests cover the direct path.
 *
 * The demo tenant's own rate is read first and restored at the end: it is the tenant every other
 * spec signs into, and leaving it on a test price would quietly skew the MRR figure on the
 * platform dashboard.
 */

async function readRate(): Promise<number | null> {
  return withDb(async (c) => {
    const r = await c.query(
      'SELECT s."customMonthlyPricePaisa" AS rate FROM "Subscription" s JOIN "Tenant" t ON t.id = s."tenantId" WHERE t.slug = $1',
      [TENANT_SLUG]
    );
    return r.rows[0].rate as number | null;
  });
}

test.describe("Per-tenant monthly fee", () => {
  let tenantId: string;
  let originalRate: number | null;

  test.beforeAll(async () => {
    originalRate = await readRate();
    tenantId = await withDb(
      async (c) => (await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [TENANT_SLUG])).rows[0].id as string
    );
  });

  test.afterAll(async () => {
    await withDb((c) =>
      c.query('UPDATE "Subscription" SET "customMonthlyPricePaisa" = $1 WHERE "tenantId" = $2', [originalRate, tenantId])
    );
  });

  test("sets a negotiated fee, and clearing it falls back to the plan formula", async ({ baseURL }) => {
    const { ctx: admin, restore } = await platformAdmin(baseURL!);
    try {
      const set = await admin.patch(`/api/platform/tenants/${tenantId}/rate`, {
        data: { customMonthlyPricePaisa: 777_700 },
      });
      expect(set.ok(), await set.text()).toBeTruthy();
      expect(await readRate()).toBe(777_700);

      // The override has to be reversible, and null is the only way back — an empty field or a
      // zero would both be wrong (zero is a real, valid price: a free account).
      const zero = await admin.patch(`/api/platform/tenants/${tenantId}/rate`, {
        data: { customMonthlyPricePaisa: 0 },
      });
      expect(zero.ok(), "zero is a legitimate fee, not a way to clear the override").toBeTruthy();
      expect(await readRate()).toBe(0);

      const cleared = await admin.patch(`/api/platform/tenants/${tenantId}/rate`, {
        data: { customMonthlyPricePaisa: null },
      });
      expect(cleared.ok(), await cleared.text()).toBeTruthy();
      expect(await readRate(), "clearing must remove the override, not store a zero").toBeNull();
    } finally {
      await restore();
    }
  });

  test("the change is written to the audit log with both the old and new price", async ({ baseURL }) => {
    const { ctx: admin, restore } = await platformAdmin(baseURL!);
    try {
      await admin.patch(`/api/platform/tenants/${tenantId}/rate`, { data: { customMonthlyPricePaisa: null } });
      const res = await admin.patch(`/api/platform/tenants/${tenantId}/rate`, {
        data: { customMonthlyPricePaisa: 654_300 },
      });
      expect(res.ok()).toBeTruthy();

      // What a tenant was charged before a renegotiation is exactly the thing that gets disputed
      // later, so the entry has to carry both sides, not just the new number.
      const entry = await withDb(async (c) =>
        (
          await c.query(
            `SELECT metadata FROM "AuditLog"
              WHERE action = 'platform.billing.rate.change' AND "tenantId" = $1
              ORDER BY "createdAt" DESC LIMIT 1`,
            [tenantId]
          )
        ).rows[0]?.metadata
      );
      expect(entry).toBeTruthy();
      expect(entry.from).toBeNull();
      expect(entry.to).toBe(654_300);
      expect(entry.platformUserEmail).toContain("@");
    } finally {
      await restore();
    }
  });

  test("rejects a negative fee", async ({ baseURL }) => {
    const { ctx: admin, restore } = await platformAdmin(baseURL!);
    try {
      const res = await admin.patch(`/api/platform/tenants/${tenantId}/rate`, {
        data: { customMonthlyPricePaisa: -1 },
      });
      expect(res.status()).toBe(400);
    } finally {
      await restore();
    }
  });

  test("a tenant owner cannot change what they are billed", async ({ request }) => {
    // The most obvious abuse of this route, and the one that matters: a restaurant setting its own
    // price to zero. Platform routes refuse a tenant session outright.
    const res = await request.patch(`/api/platform/tenants/${tenantId}/rate`, {
      data: { customMonthlyPricePaisa: 0 },
    });
    expect(res.status()).toBe(401);
  });
});
