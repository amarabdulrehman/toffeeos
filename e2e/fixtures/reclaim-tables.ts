import { request as playwrightRequest } from "@playwright/test";
import { authFile } from "./test-data";

/** The suite's own server — the port playwright.config.ts uses (E2E_PORT, else 3100), never the interactive dev ports. */
const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT) || 3100}`;

/**
 * Voids every open test order and returns every table to AVAILABLE.
 *
 * Several specs deliberately leave orders SENT_TO_KITCHEN or READY — that is the state they are
 * testing — and each one keeps its table OCCUPIED. The demo branch has a fixed pool of sixteen.
 * This used to run only once, in global teardown, which was enough while the suite ran in one
 * browser. With the iPad project added the Chrome specs had already occupied every table before
 * the first iPad spec started, and nine of them failed with nowhere to seat an order. Nothing was
 * wrong with Safari.
 *
 * Voided rather than paid: these are synthetic orders, and paid orders elsewhere in this database
 * serve as realistic demo history that test revenue should not pollute.
 *
 * Always as the owner, whoever is asking. The caller is often a cashier, who may not void.
 */
export async function reclaimTables(): Promise<void> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: authFile("owner") });
  try {
    const ordersRes = await ctx.get("/api/orders");
    if (ordersRes.ok()) {
      const { orders } = await ordersRes.json();
      for (const o of orders as { id: string; status: string }[]) {
        if (["OPEN", "SENT_TO_KITCHEN", "READY"].includes(o.status)) {
          await ctx.post(`/api/orders/${o.id}/void`, { data: { reason: "E2E suite cleanup" } }).catch(() => {});
        }
      }
    }

    const tablesRes = await ctx.get("/api/tables");
    if (!tablesRes.ok()) return;
    const { floors } = await tablesRes.json();
    for (const floor of floors as { tables: { id: string; status: string }[] }[]) {
      for (const table of floor.tables) {
        if (table.status !== "AVAILABLE") {
          await ctx.patch(`/api/tables/${table.id}/status`, { data: { status: "AVAILABLE" } }).catch(() => {});
        }
      }
    }
  } finally {
    await ctx.dispose();
  }
}
