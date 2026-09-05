import "dotenv/config";
import { Client } from "pg";

/**
 * One-off demo-data script: gives the demo tenant a believable cost base so the P&L reads like a
 * real restaurant's rather than a 90%-margin fantasy.
 *
 * The seed (prisma/seed.ts) generates months of orders but almost no costs — three of its five
 * stock receipts have no cost recorded at all, and there is a single payroll disbursement. The P&L
 * was therefore arithmetically correct and completely unconvincing: Rs 284,582 of revenue against
 * Rs 30,170 of costs, an 89.4% margin no food business has ever had.
 *
 * Targets, as a share of August's net revenue (the month the seed's orders actually land in):
 * stock ~30%, labour ~30%, other operating expenses ~18% — leaving a ~22% margin, which is a
 * plausible, healthy small-restaurant result.
 *
 * SAFE TO RE-RUN: it does nothing if the demo tenant already has expense rows. That guard is also
 * what stops it ever injecting invented figures into a tenant carrying real data.
 *
 * Deliberately scoped to the karachi-karahi demo tenant by slug — it can't touch a real tenant.
 */

const DEMO_SLUG = "karachi-karahi";

/** August 2026 is where the seed's paid orders sit, so it's the month that gets a full cost base. */
const AUGUST_EXPENSES: [string, number, number, string][] = [
  // [category, day of month, rupees, vendor]
  ["Rent", 1, 22_000, "Gulshan Properties"],
  ["Utilities", 4, 9_500, "K-Electric"],
  ["Supplies", 8, 6_800, "Metro Cash & Carry"],
  ["Repairs & Maintenance", 13, 4_200, "CoolTech Refrigeration"],
  ["Marketing", 17, 3_000, "Facebook Ads"],
  ["Transport", 21, 2_600, "Fuel & delivery"],
  ["Licenses & Fees", 26, 1_900, "Cantonment Board"],
];

/** September is only a few days old in the demo, so it gets variable costs only — no rent yet.
 * A partial month carrying a full month's fixed costs would show a loss that says more about the
 * calendar than about the business. */
const SEPTEMBER_EXPENSES: [string, number, number, string][] = [
  ["Supplies", 2, 2_100, "Metro Cash & Carry"],
  ["Transport", 4, 1_400, "Fuel & delivery"],
];

/** Monthly gross pay by role key, chosen so the total lands near 30% of net revenue. */
const SALARY_BY_ROLE: Record<string, number> = {
  branch_manager: 18_000,
  cashier: 12_000,
  kitchen: 14_000,
  waiter: 9_000,
  rider: 6_500,
  // The owner draws profit rather than a wage — counting one here would double-count the bottom line.
  owner: 0,
};

/** Filled into the seed's three cost-less stock receipts, in date order. */
const GRN_COSTS_RUPEES = [31_500, 26_400, 21_500];

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  const tenantRes = await c.query('SELECT id FROM "Tenant" WHERE slug = $1', [DEMO_SLUG]);
  if (tenantRes.rowCount === 0) throw new Error(`Demo tenant "${DEMO_SLUG}" not found`);
  const tenantId = tenantRes.rows[0].id;

  const existing = await c.query('SELECT count(*)::int n FROM "Expense" WHERE "tenantId" = $1', [tenantId]);
  if (existing.rows[0].n > 0) {
    console.log(`Demo tenant already has ${existing.rows[0].n} expense(s) — nothing to do.`);
    await c.end();
    return;
  }

  // The branch the seeded orders belong to, so costs and revenue land in the same place.
  const branchRes = await c.query(
    `SELECT "branchId", count(*)::int n FROM "Order"
      WHERE "tenantId" = $1 AND status = 'PAID' GROUP BY 1 ORDER BY n DESC LIMIT 1`,
    [tenantId]
  );
  const branchId = branchRes.rows[0].branchId;

  const ownerRes = await c.query('SELECT id FROM "User" WHERE "tenantId" = $1 AND email = $2', [
    tenantId,
    "owner@karachikarahi.pk",
  ]);
  const ownerId = ownerRes.rows[0].id;

  const catRes = await c.query('SELECT id, name FROM "ExpenseCategory" WHERE "tenantId" = $1', [tenantId]);
  const categoryId = new Map<string, string>(catRes.rows.map((r) => [r.name as string, r.id as string]));

  // ---- Expenses ----
  let expenseCount = 0;
  let expenseTotal = 0;
  const insertExpense = async (rows: [string, number, number, string][], year: number, month: number) => {
    for (const [category, day, rupees, vendor] of rows) {
      const id = categoryId.get(category);
      if (!id) {
        console.warn(`  (skipped "${category}" — no such category on this tenant)`);
        continue;
      }
      await c.query(
        `INSERT INTO "Expense"
           (id, "tenantId", "branchId", "categoryId", "spentAt", "amountPaisa", "vendorName", method,
            status, "recordedById", "approvedById", "approvedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'CASH', 'APPROVED', $7, $7, $4)`,
        [tenantId, branchId, id, new Date(Date.UTC(year, month, day)), rupees * 100, vendor, ownerId]
      );
      expenseCount++;
      expenseTotal += rupees;
    }
  };
  await insertExpense(AUGUST_EXPENSES, 2026, 7);
  await insertExpense(SEPTEMBER_EXPENSES, 2026, 8);
  console.log(`Inserted ${expenseCount} expenses totalling Rs ${expenseTotal.toLocaleString()}.`);

  // ---- Stock receipt costs ----
  const grns = await c.query(
    `SELECT id FROM "StockMovement"
      WHERE "tenantId" = $1 AND type = 'GRN' AND "costPaisa" IS NULL ORDER BY "createdAt"`,
    [tenantId]
  );
  let grnTotal = 0;
  for (let i = 0; i < grns.rows.length; i++) {
    const rupees = GRN_COSTS_RUPEES[i % GRN_COSTS_RUPEES.length];
    await c.query('UPDATE "StockMovement" SET "costPaisa" = $1, "supplierName" = COALESCE("supplierName", $2) WHERE id = $3', [
      rupees * 100,
      "Karachi Meat Co",
      grns.rows[i].id,
    ]);
    grnTotal += rupees;
  }
  console.log(`Filled cost on ${grns.rowCount} stock receipt(s), Rs ${grnTotal.toLocaleString()}.`);

  // ---- Payroll ----
  const members = await c.query(
    `SELECT m.id, r.key FROM "Membership" m JOIN "Role" r ON m."roleId" = r.id
      WHERE m."tenantId" = $1 AND m."isActive" AND m."branchId" = $2`,
    [tenantId, branchId]
  );
  let payrollTotal = 0;
  let payrollCount = 0;
  for (const row of members.rows) {
    const rupees = SALARY_BY_ROLE[row.key as string] ?? 0;
    if (rupees === 0) continue;
    await c.query(
      `INSERT INTO "PayrollDisbursement"
         (id, "tenantId", "branchId", "membershipId", "periodStart", "periodEnd",
          "regularHours", "overtimeHours", "grossPayPaisa", method, "paidById", "paidAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 208, 0, $6, 'CASH', $7, $5)`,
      [
        tenantId,
        branchId,
        row.id,
        new Date(Date.UTC(2026, 7, 1)),
        new Date(Date.UTC(2026, 7, 31)),
        rupees * 100,
        ownerId,
      ]
    );
    payrollTotal += rupees;
    payrollCount++;
  }
  console.log(`Inserted ${payrollCount} payroll disbursement(s) totalling Rs ${payrollTotal.toLocaleString()}.`);

  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
