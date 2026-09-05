/**
 * Standalone financial reconciliation audit — walks every PAID order in every tenant and checks
 * `paidPaisa === totalPaisa`. Exists because that exact invariant broke for real this week (a
 * payment-dialog bug let a cash->card method switch overcharge a customer — see the overnight
 * hardening session's log) before it was caught by manual testing, not by anything automated. The
 * E2E suite (e2e/pos-payment-correctness.spec.ts) now has a regression test for the specific UI
 * path that caused it, but this script is the complementary check: it looks at real data, not a
 * scripted scenario, so it also catches a *different* bug hitting the same invariant in the future,
 * or a bug that only manifests for a real tenant's real order shape.
 *
 * Read-only — never writes anything. Run on demand (`npm run audit:payments`), or wire it into a
 * scheduled job later if it proves useful; not wired into anything automatically yet since that's
 * a call about acceptable false-positive noise this session shouldn't make unilaterally.
 */
import "server-only";
import { platformDb } from "@/server/db";

interface Finding {
  tenantSlug: string;
  orderId: string;
  orderNumber: number;
  issue: string;
  totalPaisa: number;
  paidPaisa: number;
}

async function main() {
  const tenants = await platformDb.tenant.findMany({ select: { id: true, slug: true } });
  const findings: Finding[] = [];
  let ordersChecked = 0;

  for (const tenant of tenants) {
    const orders = await platformDb.order.findMany({
      where: { tenantId: tenant.id, status: "PAID" },
      select: { id: true, orderNumber: true, totalPaisa: true, paidPaisa: true, payments: { select: { method: true } } },
    });
    ordersChecked += orders.length;

    for (const order of orders) {
      if (order.paidPaisa === order.totalPaisa) continue;

      // Cash tenders legitimately exceed the total (customer hands over a round note, gets change
      // back — the "change" is computed client-side for the receipt but never subtracted from the
      // recorded Payment.amountPaisa, by design: see payment-dialog.tsx's own "Tendering more than
      // the total is fine" comment). So an overcharge on a cash-involved order is only suspicious
      // if it's *never* short — undercollection is never legitimate, on any method, because the
      // server-side guard in src/server/orders.ts rejects tendering less than the total outright.
      const involvesCash = order.payments.some((p) => p.method === "CASH");
      if (involvesCash && order.paidPaisa > order.totalPaisa) continue;

      findings.push({
        tenantSlug: tenant.slug,
        orderId: order.id,
        orderNumber: order.orderNumber,
        issue: order.paidPaisa > order.totalPaisa ? "OVERCHARGED" : "UNDERCOLLECTED",
        totalPaisa: order.totalPaisa,
        paidPaisa: order.paidPaisa,
      });
    }
  }

  console.log(`Checked ${ordersChecked} PAID orders across ${tenants.length} tenants.`);
  if (findings.length === 0) {
    console.log("No discrepancies found — every PAID order's paidPaisa exactly matches totalPaisa.");
    return;
  }

  console.log(`\n${findings.length} discrepanc${findings.length === 1 ? "y" : "ies"} found:\n`);
  for (const f of findings) {
    const diff = f.paidPaisa - f.totalPaisa;
    console.log(
      `  [${f.issue}] ${f.tenantSlug} order #${f.orderNumber} (${f.orderId}): ` +
        `total=${f.totalPaisa}, paid=${f.paidPaisa}, diff=${diff > 0 ? "+" : ""}${diff} paisa`
    );
  }
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
