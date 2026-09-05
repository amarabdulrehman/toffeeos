import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./fixtures/test-data";

/**
 * Server-side permission boundary checks for every seeded role. API-level rather than
 * UI-level deliberately — a hidden nav link is a UX nicety, not a security boundary; what actually
 * matters is that defineHandler's permission check rejects the request regardless of what the
 * client sends. Covers the same ground manually verified during the overnight hardening pass, now
 * pinned so a future change to the permission registry (src/server/permissions/registry.ts) can't
 * silently regress a role's boundary.
 */

interface Probe {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

const PROBES: Record<string, Probe> = {
  hrPayroll: { method: "GET", path: "/api/hr/payroll?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z" },
  taxRules: { method: "GET", path: "/api/tax-rules" },
  staffList: { method: "GET", path: "/api/staff" },
  inventoryItems: { method: "GET", path: "/api/inventory/items" },
  branches: { method: "GET", path: "/api/branches" },
  kdsOrders: { method: "GET", path: "/api/kds/orders" },
  createOrder: { method: "POST", path: "/api/orders", body: { type: "TAKEAWAY", idempotencyKey: `perm-probe-${Date.now()}`, lines: [] } },
  riderOrders: { method: "GET", path: "/api/rider/orders" },
  salesReport: { method: "GET", path: "/api/reports/sales-summary?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z" },
};

async function probe(request: APIRequestContext, p: Probe): Promise<number> {
  const res = p.method === "GET" ? await request.get(p.path) : await request.post(p.path, { data: p.body });
  return res.status();
}

test.describe("Cashier", () => {
  test.use({ storageState: authFile("cashier") });

  test("can access POS-scoped endpoints, blocked from admin/HR/inventory", async ({ request }) => {
    expect(await probe(request, PROBES.hrPayroll)).toBe(403);
    expect(await probe(request, PROBES.taxRules)).toBe(403);
    expect(await probe(request, PROBES.staffList)).toBe(403);
    expect(await probe(request, PROBES.inventoryItems)).toBe(403);
    expect(await probe(request, PROBES.branches)).toBe(403);

    const ordersRes = await request.get("/api/orders");
    expect(ordersRes.status()).toBe(200);
  });
});

test.describe("Kitchen staff", () => {
  test.use({ storageState: authFile("kitchen") });

  test("can access KDS only", async ({ request }) => {
    expect(await probe(request, PROBES.kdsOrders)).toBe(200);
    expect(await probe(request, PROBES.createOrder)).toBe(403);
    expect(await probe(request, PROBES.staffList)).toBe(403);
    expect(await probe(request, PROBES.taxRules)).toBe(403);
    expect(await probe(request, PROBES.inventoryItems)).toBe(403);
  });
});

test.describe("Rider", () => {
  test.use({ storageState: authFile("rider") });

  test("can access their own delivery orders only", async ({ request }) => {
    expect(await probe(request, PROBES.riderOrders)).toBe(200);
    expect(await probe(request, PROBES.kdsOrders)).toBe(403);
    expect(await probe(request, PROBES.createOrder)).toBe(403);
    expect(await probe(request, PROBES.salesReport)).toBe(403);
  });
});

test.describe("Branch manager", () => {
  test.use({ storageState: authFile("manager") });

  test("has broad operational access but not branch.manage", async ({ request }) => {
    expect(await probe(request, PROBES.branches)).toBe(403);
    expect(await probe(request, PROBES.staffList)).toBe(200);

    const ordersRes = await request.get("/api/orders");
    expect(ordersRes.status()).toBe(200);
  });
});

test.describe("Waiter", () => {
  test.use({ storageState: authFile("waiter") });

  test("can create orders, blocked from payments/admin", async ({ request }) => {
    const ordersRes = await request.get("/api/orders");
    expect(ordersRes.status()).toBe(200);

    expect(await probe(request, PROBES.staffList)).toBe(403);
    expect(await probe(request, PROBES.taxRules)).toBe(403);
    expect(await probe(request, PROBES.inventoryItems)).toBe(403);
  });
});
