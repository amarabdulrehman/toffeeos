import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";
import { getMenuItemId } from "./fixtures/api";

/**
 * Where a refund has to show up besides the order itself.
 *
 * Refunds were added in a week when three other screens were already summing Order.totalPaisa,
 * and none of them were told. The P&L is pinned in pnl.spec.ts. These are the other two, which
 * were fixed alongside it but had no test of their own until now:
 *
 * - Staff performance: a cashier's sales figure that still counts money handed back is wrong, and
 *   if anything is ever paid on it, it is gameable — ring up a large order, refund it tomorrow,
 *   keep the credit.
 * - Customer lifetime spend: this decides who the CRM treats as a regular, and who the win-back
 *   message goes to. Someone refunded in full has not spent anything.
 */

const WIDE_RANGE = (() => {
  const to = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)).toISOString().slice(0, 10);
  return `from=2024-01-01&to=${to}`;
})();

/** Creates and fully pays a takeaway order. Returns what the server says it charged. */
async function paidOrder(request: APIRequestContext, opts: { customerId?: string } = {}) {
  const menuItemId = await getMenuItemId(request, "Fish Pakora");
  const created = await request.post("/api/orders", {
    data: {
      type: "TAKEAWAY",
      idempotencyKey: `refund-consequence-${uniqueSuffix()}`,
      customerId: opts.customerId,
      lines: [{ menuItemId, quantity: 2 }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const order = (await created.json()).order;

  const paid = await request.post(`/api/orders/${order.id}/pay`, {
    data: { tenders: [{ method: "CASH", amountPaisa: order.totalPaisa }] },
  });
  expect(paid.ok(), await paid.text()).toBeTruthy();
  const settled = (await paid.json()).order;

  return {
    id: order.id as string,
    createdById: order.createdById as string,
    paidPaisa: settled.paidPaisa as number,
  };
}

async function refund(request: APIRequestContext, orderId: string, amountPaisa: number) {
  const res = await request.post(`/api/orders/${orderId}/refund`, {
    data: { amountPaisa, method: "CASH", reason: "refund consequences probe" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("Refunds reach the other reports", () => {
  test.use({ storageState: authFile("owner") });
  test.describe.configure({ timeout: 150_000 });

  test("a cashier's sales figure drops by what they refunded", async ({ request }) => {
    /** Everything this staff member sold in the range, across every day row. */
    async function salesFor(staffId: string): Promise<number> {
      const res = await request.get(`/api/reports/staff-performance?${WIDE_RANGE}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      const rows = (await res.json()).rows as { staffId: string; totalPaisa: number }[];
      return rows.filter((r) => r.staffId === staffId).reduce((sum, r) => sum + r.totalPaisa, 0);
    }

    // Measured around a sale and then around its refund, rather than as absolute figures, so the
    // months of demo history already on this tenant do not matter.
    const probe = await paidOrder(request);
    expect(probe.createdById, "the order should record who rang it up").toBeTruthy();

    const beforeRefund = await salesFor(probe.createdById);

    const refunded = Math.floor(probe.paidPaisa / 2);
    await refund(request, probe.id, refunded);

    const afterRefund = await salesFor(probe.createdById);
    expect(
      beforeRefund - afterRefund,
      "the refund must come off the sales figure of the cashier who rang up the order"
    ).toBe(refunded);
  });

  test("a customer refunded in full has spent nothing", async ({ request }) => {
    const phone = `0300${String(Date.now()).slice(-7)}`;
    const made = await request.post("/api/customers/find-or-create", {
      data: { phone, name: `Refund Probe ${uniqueSuffix()}` },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    const customerId = (await made.json()).customer.id as string;

    async function spend() {
      const res = await request.get(`/api/customers?q=${phone}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      const customer = ((await res.json()).customers as { id: string; totalSpendPaisa: number; totalOrders: number }[]).find(
        (c) => c.id === customerId
      );
      expect(customer, "the probe customer should be listed").toBeTruthy();
      return customer!;
    }

    const probe = await paidOrder(request, { customerId });
    const afterSale = await spend();
    expect(afterSale.totalSpendPaisa).toBe(probe.paidPaisa);
    expect(afterSale.totalOrders).toBe(1);

    await refund(request, probe.id, probe.paidPaisa);

    const afterRefund = await spend();
    expect(afterRefund.totalSpendPaisa, "a full refund leaves no lifetime spend").toBe(0);
    // The visit still happened. It is the money that went back, not the order.
    expect(afterRefund.totalOrders).toBe(1);
  });
});
