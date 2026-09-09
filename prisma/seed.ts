import "dotenv/config";
import "server-only";
import { addDays, subDays, subHours } from "date-fns";
import { rawDb, platformDb, tenantDb } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { newId, newOrderId, newOrderLineId } from "@/lib/ids";
import { hashPassword, hashPin } from "@/lib/password";
import { SEED_ROLES } from "@/server/permissions/registry";
import { finalizeOrder, type PricingLineInput, type TaxRuleInput } from "@/lib/pricing";
import { defaultExpenseCategoryRows } from "@/lib/expense-categories";
import { GATEABLE_MODULES } from "@/lib/tiers";

// Every write below the initial Tenant row goes through tenantDb(tenantId), never rawDb directly —
// rawDb is RLS-bound (app_user) and, with no app.tenant_id session var set, RLS's WITH CHECK would
// reject every insert. tenantDb() handles the set_config(...)+query dance per call. See
// src/server/tenant-signup.ts for the same bootstrap pattern used at real signup time.

/**
 * Both passwords come from the environment and have no committed default, deliberately.
 *
 * They used to be the literals "Passw0rd!" and "ChangeMe123!" right here. Because this repo's dev,
 * test and production all point at one database, that meant the seeded accounts on the live public
 * deployment — including the demo tenant's *owner* — were openable by anyone who read this file.
 * A default here would quietly recreate that the next time someone seeds, so there isn't one.
 */
function requiredEnv(name: string, usedFor: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set, and there is no default on purpose — it would end up as a live password ` +
        `on whatever database this points at. Set it in .env (gitignored) before seeding. Used for: ${usedFor}.`
    );
  }
  return value;
}

const DEMO_PASSWORD = requiredEnv("DEMO_SEED_PASSWORD", "the demo tenant's owner and staff logins");
const DEMO_PIN = process.env.DEMO_SEED_PIN ?? "1234";
const PLATFORM_EMAIL = "admin@tableos.app";
const PLATFORM_PASSWORD = requiredEnv("PLATFORM_SEED_PASSWORD", "the platform super-admin login");

// Phase D's three tiers — feature gating keys off Plan.key directly (see src/server/tier.ts),
// not a separate field, so these three key strings are load-bearing beyond just pricing.
// maxBranches: null means unlimited (Complete).
async function seedPlans() {
  const plans = [
    { key: "starter", name: "Starter", maxBranches: 1, pricePaisaPerBranchMonth: 4_999_00 },
    { key: "growth", name: "Growth", maxBranches: 3, pricePaisaPerBranchMonth: 3_999_00 },
    { key: "complete", name: "Complete", maxBranches: null, pricePaisaPerBranchMonth: 2_999_00 },
  ];
  for (const plan of plans) {
    await rawDb.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
  }
  console.log(`Seeded ${plans.length} plans.`);
}

async function seedPlatformUser() {
  const passwordHash = await hashPassword(PLATFORM_PASSWORD);
  await platformDb.platformUser.upsert({
    where: { email: PLATFORM_EMAIL },
    update: {},
    create: { email: PLATFORM_EMAIL, name: "Platform Owner", passwordHash },
  });
  console.log(`Platform admin: ${PLATFORM_EMAIL} / ${PLATFORM_PASSWORD}`);
}

interface CategorySeed {
  name: string;
  items: { name: string; priceRs: number; variants?: { name: string; deltaRs: number }[] }[];
}

const MENU: CategorySeed[] = [
  {
    name: "Starters",
    items: [
      { name: "Chicken Seekh Kebab", priceRs: 450 },
      { name: "Beef Chapli Kebab", priceRs: 480 },
      { name: "Dahi Bhalla", priceRs: 250 },
      { name: "Chicken Wings (6pc)", priceRs: 550 },
      { name: "Vegetable Samosa (4pc)", priceRs: 200 },
      { name: "Fish Pakora", priceRs: 500 },
    ],
  },
  {
    name: "BBQ",
    items: [
      { name: "Chicken Malai Boti", priceRs: 650 },
      { name: "Beef Bihari Boti", priceRs: 700 },
      { name: "Mutton Chops", priceRs: 950 },
      { name: "Chicken Tikka", priceRs: 600 },
      { name: "Reshmi Kebab", priceRs: 680 },
    ],
  },
  {
    name: "Karahi",
    items: [
      { name: "Chicken Karahi", priceRs: 1400, variants: [{ name: "Half", deltaRs: 0 }, { name: "Full", deltaRs: 1200 }] },
      { name: "Mutton Karahi", priceRs: 2200, variants: [{ name: "Half", deltaRs: 0 }, { name: "Full", deltaRs: 1900 }] },
      { name: "Karahi Gosht", priceRs: 2000 },
      { name: "White Karahi", priceRs: 1600 },
    ],
  },
  {
    name: "Rice & Biryani",
    items: [
      { name: "Chicken Biryani", priceRs: 380 },
      { name: "Mutton Biryani", priceRs: 550 },
      { name: "Beef Pulao", priceRs: 400 },
      { name: "Vegetable Pulao", priceRs: 300 },
      { name: "Chicken White Rice", priceRs: 420 },
    ],
  },
  {
    name: "Bread",
    items: [
      { name: "Naan", priceRs: 60 },
      { name: "Garlic Naan", priceRs: 90 },
      { name: "Roghni Naan", priceRs: 100 },
      { name: "Roti", priceRs: 40 },
    ],
  },
  {
    name: "Beverages",
    items: [
      { name: "Soft Drink (Can)", priceRs: 120 },
      { name: "Fresh Lime", priceRs: 180 },
      { name: "Lassi", priceRs: 220 },
      { name: "Mineral Water", priceRs: 80 },
      { name: "Kashmiri Chai", priceRs: 200 },
    ],
  },
  {
    name: "Desserts",
    items: [
      { name: "Gulab Jamun (2pc)", priceRs: 180 },
      { name: "Kheer", priceRs: 220 },
      { name: "Kulfi Falooda", priceRs: 350 },
      { name: "Gajar Halwa", priceRs: 250 },
    ],
  },
];

async function seedMenu(db: PrismaClient, tenantId: string, branchIds: string[]) {
  for (const category of MENU) {
    const cat = await db.category.create({ data: { tenantId, name: category.name } });
    for (const item of category.items) {
      const menuItem = await db.menuItem.create({
        data: {
          tenantId,
          categoryId: cat.id,
          name: item.name,
          basePricePaisa: item.priceRs * 100,
          allergens: [],
        },
      });
      if (item.variants) {
        for (const [i, v] of item.variants.entries()) {
          await db.itemVariant.create({
            data: {
              tenantId,
              menuItemId: menuItem.id,
              name: v.name,
              priceDeltaPaisa: v.deltaRs * 100,
              isDefault: i === 0,
              sortOrder: i,
            },
          });
        }
      }
      for (const branchId of branchIds) {
        await db.branchMenuItem.create({
          data: { tenantId, branchId, menuItemId: menuItem.id, isAvailable: true },
        });
      }
    }
  }
  const itemCount = MENU.reduce((a, c) => a + c.items.length, 0);
  console.log(`Seeded ${MENU.length} categories, ${itemCount} menu items.`);
}

async function seedFloorAndTables(db: PrismaClient, tenantId: string, branchId: string) {
  const floor = await db.floor.create({ data: { tenantId, branchId, name: "Ground Floor" } });
  for (let i = 1; i <= 8; i++) {
    await db.restaurantTable.create({
      data: { tenantId, branchId, floorId: floor.id, label: `T${i}`, seats: i % 3 === 0 ? 6 : 4 },
    });
  }
}

async function seedTaxAndSettings(db: PrismaClient, tenantId: string, branchId: string) {
  await db.branchSettings.create({
    data: { tenantId, branchId, serviceChargeBasisPoints: 500, roundingMode: "NEAREST_1" },
  });
  await db.taxRule.createMany({
    data: [
      { tenantId, branchId, name: "Cash (PRA)", paymentMethods: ["CASH"], rateBasisPoints: 1600 },
      {
        tenantId,
        branchId,
        name: "Card & digital (PRA)",
        paymentMethods: ["CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"],
        rateBasisPoints: 800,
      },
    ],
  });
}

async function seedStaff(db: PrismaClient, tenantId: string, branchId: string, roleIdByKey: Record<string, string>) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const pinHash = await hashPin(DEMO_PIN);

  const owner = await db.user.create({
    data: { tenantId, name: "Ahmed Raza (Owner)", email: "owner@karachikarahi.pk", passwordHash, isActive: true },
  });
  await db.membership.create({
    data: { tenantId, userId: owner.id, branchId, roleId: roleIdByKey.owner, isActive: true },
  });

  const staffToSeed: { name: string; roleKey: string; email: string; withPin: boolean }[] = [
    { name: "Bilal Manager", roleKey: "branch_manager", email: "manager@karachikarahi.pk", withPin: false },
    { name: "Sara Cashier", roleKey: "cashier", email: "cashier@karachikarahi.pk", withPin: true },
    { name: "Usman Waiter", roleKey: "waiter", email: "waiter@karachikarahi.pk", withPin: true },
    { name: "Imran Kitchen", roleKey: "kitchen", email: "kitchen@karachikarahi.pk", withPin: true },
    { name: "Faisal Rider", roleKey: "rider", email: "rider@karachikarahi.pk", withPin: false },
  ];

  for (const s of staffToSeed) {
    const user = await db.user.create({
      data: { tenantId, name: s.name, email: s.email, passwordHash, isActive: true },
    });
    await db.membership.create({
      data: { tenantId, userId: user.id, branchId, roleId: roleIdByKey[s.roleKey], isActive: true },
    });
    if (s.withPin) {
      await db.staffPin.create({ data: { tenantId, userId: user.id, pinHash } });
    }
  }

  console.log(
    `Seeded owner + ${staffToSeed.length} staff. Password for all: ${DEMO_PASSWORD} (PIN ${DEMO_PIN} for cashier/waiter/kitchen)`
  );
  return owner;
}

async function seedHistoricalOrders(db: PrismaClient, tenantId: string, branchId: string, actorId: string) {
  const items = await db.menuItem.findMany({ where: { tenantId }, take: 15 });
  const taxRuleRows = await db.taxRule.findMany({ where: { branchId } });
  const taxRules: TaxRuleInput[] = taxRuleRows.map((r) => ({
    paymentMethods: r.paymentMethods as TaxRuleInput["paymentMethods"],
    rateBasisPoints: r.rateBasisPoints,
  }));

  let orderNumber = 1;
  const methods = ["CASH", "CARD", "JAZZCASH"] as const;

  for (let day = 5; day >= 0; day--) {
    const ordersThatDay = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < ordersThatDay; i++) {
      const lineCount = 1 + Math.floor(Math.random() * 3);
      const chosen = Array.from({ length: lineCount }, () => items[Math.floor(Math.random() * items.length)]);
      const pricingLines: PricingLineInput[] = chosen.map((item, idx) => ({
        id: `seed-${idx}`,
        unitPricePaisa: item.basePricePaisa,
        quantity: 1 + Math.floor(Math.random() * 2),
      }));

      const method = methods[Math.floor(Math.random() * methods.length)];
      const settings = {
        serviceChargeBasisPoints: 500,
        serviceChargeApplies: true,
        serviceChargeTaxable: true,
        roundingMode: "NEAREST_1" as const,
      };
      const roughTotal = pricingLines.reduce((a, l) => a + l.unitPricePaisa * l.quantity, 0);
      const totals = finalizeOrder(pricingLines, undefined, taxRules, settings, [
        { method, amountPaisa: Math.round(roughTotal * 1.3) },
      ]);

      const orderId = newOrderId();
      const paidAt = subHours(subDays(new Date(), day), Math.floor(Math.random() * 10));

      await db.order.create({
        data: {
          id: orderId,
          tenantId,
          branchId,
          idempotencyKey: newId(),
          createdById: actorId,
          orderNumber: orderNumber++,
          type: "DINE_IN",
          status: "PAID",
          subtotalPaisa: totals.subtotalPaisa,
          discountedSubtotalPaisa: totals.discountedSubtotalPaisa,
          serviceChargePaisa: totals.serviceChargePaisa,
          taxPaisa: totals.taxPaisa,
          totalPaisa: totals.totalPaisa,
          paidPaisa: totals.totalPaisa,
          createdAt: paidAt,
          sentToKitchenAt: paidAt,
          servedAt: paidAt,
          paidAt,
        },
      });

      for (const [idx, item] of chosen.entries()) {
        await db.orderLine.create({
          data: {
            id: newOrderLineId(),
            tenantId,
            orderId,
            menuItemId: item.id,
            nameSnapshot: item.name,
            unitPricePaisa: item.basePricePaisa,
            quantity: pricingLines[idx].quantity,
            lineTotalPaisa: item.basePricePaisa * pricingLines[idx].quantity,
          },
        });
      }

      await db.payment.create({
        data: {
          tenantId,
          orderId,
          method,
          amountPaisa: totals.totalPaisa,
          taxRateBasisPoints: totals.tenders[0]?.rateBasisPoints ?? 0,
          receivedById: actorId,
        },
      });
    }
  }
  console.log(`Seeded ${orderNumber - 1} historical paid orders for reports.`);
}

async function seedDemoTenant() {
  const slug = "karachi-karahi";
  const already = await rawDb.tenant.findUnique({ where: { slug } });
  if (already) {
    console.log(`Demo tenant "${slug}" already exists — skipping.`);
    return;
  }

  const growthPlan = await rawDb.plan.findUniqueOrThrow({ where: { key: "growth" } });
  const tenantId = newId();
  const branch1Id = newId();
  const branch2Id = newId();

  // Bootstrap: Tenant has no tenantId column of its own (nothing to scope by yet), so this one
  // create legitimately goes through rawDb directly — same as src/server/tenant-signup.ts.
  await rawDb.tenant.create({ data: { id: tenantId, name: "Karachi Karahi House", slug, status: "ACTIVE" } });

  const db = tenantDb(tenantId);

  await db.subscription.create({
    data: {
      tenantId,
      planId: growthPlan.id,
      status: "ACTIVE",
      branchLimit: growthPlan.maxBranches,
      trialEndsAt: addDays(new Date(), 14),
      currentPeriodEnd: addDays(new Date(), 30),
      // Was omitted entirely, which left it at the column default of [] — every gated feature off,
      // on a tenant whose whole purpose is demonstrating them. It went unnoticed because the only
      // seeded database anyone used was production, where a platform admin had turned the modules
      // on by hand long ago; it surfaced the moment a second database was seeded from scratch and
      // ~40 e2e tests failed with "This feature isn't enabled for this restaurant."
      //
      // Every module, not defaultModulesForTier("growth"): delivery/online/whatsapp/hr sit above
      // the Growth tier, the suite exercises all four, and production's demo tenant has them
      // custom-enabled anyway. A demo tenant with features switched off is not a demo.
      //
      // Real signups were never affected — provisionTenant (src/server/tenant-signup.ts) has always
      // set this correctly from the chosen tier.
      enabledModules: GATEABLE_MODULES.flatMap((m) => m.storageKeys),
    },
  });

  await db.branch.create({ data: { id: branch1Id, tenantId, name: "Gulshan-e-Iqbal", address: "Karachi" } });
  await db.branch.create({ data: { id: branch2Id, tenantId, name: "DHA Phase 6", address: "Karachi" } });

  await seedTaxAndSettings(db, tenantId, branch1Id);
  await seedTaxAndSettings(db, tenantId, branch2Id);
  // Tenant-wide, not per-branch — hence one call here rather than inside seedTaxAndSettings, which
  // runs once per branch. Mirrors the same seeding in provisionTenant.
  await db.expenseCategory.createMany({ data: defaultExpenseCategoryRows(tenantId) });
  await seedFloorAndTables(db, tenantId, branch1Id);
  await seedFloorAndTables(db, tenantId, branch2Id);
  await seedMenu(db, tenantId, [branch1Id, branch2Id]);

  const roleIdByKey: Record<string, string> = {};
  for (const [key, def] of Object.entries(SEED_ROLES)) {
    const role = await db.role.create({
      data: { tenantId, key, name: def.name, permissions: def.permissions, isSystem: true },
    });
    roleIdByKey[key] = role.id;
  }

  const owner = await seedStaff(db, tenantId, branch1Id, roleIdByKey);
  await seedHistoricalOrders(db, tenantId, branch1Id, owner.id);

  console.log(`Demo tenant ready: slug="${slug}"`);
}

async function main() {
  await seedPlans();
  await seedPlatformUser();
  await seedDemoTenant();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await rawDb.$disconnect();
    await platformDb.$disconnect();
  });
