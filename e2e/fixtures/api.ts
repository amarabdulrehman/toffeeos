import type { APIRequestContext } from "@playwright/test";

/**
 * Resolves real IDs from the running app rather than hardcoding UUIDs — this database carries
 * months of manual test data on top of the seed, so "the item named X" is a stable lookup while
 * "the item with this specific id" is not (seeds can be re-run, ids regenerate).
 */
export async function getMenuItemId(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.get("/api/menu");
  if (!res.ok()) throw new Error(`GET /api/menu failed: ${res.status()}`);
  const { categories } = await res.json();
  for (const category of categories) {
    const item = category.items.find((i: { name: string }) => i.name === name);
    if (item) return item.id;
  }
  throw new Error(`Menu item "${name}" not found — check e2e/fixtures/test-data.ts against the current seed`);
}

export interface TableRef {
  id: string;
  label: string;
}

/** Picks the first AVAILABLE table not already used by a still-open order, so parallel-ish test
 * runs (or a suite re-run right after a failure) don't collide on a table an earlier run left
 * occupied. */
export async function getAvailableTable(request: APIRequestContext): Promise<TableRef> {
  const res = await request.get("/api/tables");
  if (!res.ok()) throw new Error(`GET /api/tables failed: ${res.status()}`);
  const { floors } = await res.json();
  for (const floor of floors) {
    for (const table of floor.tables) {
      if (table.status === "AVAILABLE") return { id: table.id, label: table.label };
    }
  }
  throw new Error("No AVAILABLE table found — the demo tenant's floor may be fully occupied by leftover test orders");
}

export interface OrderSummary {
  id: string;
  orderNumber: number;
  status: string;
  totalPaisa: number;
  paidPaisa: number;
  taxPaisa: number;
}

export async function getOrder(request: APIRequestContext, orderId: string): Promise<OrderSummary> {
  const res = await request.get("/api/orders");
  if (!res.ok()) throw new Error(`GET /api/orders failed: ${res.status()}`);
  const { orders } = await res.json();
  const order = orders.find((o: OrderSummary) => o.id === orderId);
  if (!order) throw new Error(`Order ${orderId} not found in /api/orders`);
  return order;
}

export async function createOrder(
  request: APIRequestContext,
  input: { type: "DINE_IN" | "TAKEAWAY"; tableId?: string; lines: { menuItemId: string; quantity: number }[] }
): Promise<{ id: string; orderNumber: number; totalPaisa: number }> {
  const res = await request.post("/api/orders", {
    data: { ...input, idempotencyKey: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  if (!res.ok()) throw new Error(`POST /api/orders failed: ${res.status()} ${await res.text()}`);
  const { order } = await res.json();
  return order;
}
