import "dotenv/config";
import "server-only";
import { rawDb, tenantDb } from "@/server/db";
import { MENU, MOD_GROUPS, rs, type ModKey } from "./spill-menu";

/**
 * Onboards the Spill café: one tenant, its full menu, sizes, and add-ons.
 *
 * Written as a script rather than done by hand because the menu was transcribed from two photos of
 * a printed board, and photographed prices need correcting. Re-running with MENU_REPLACE=1 rebuilds
 * the menu from the table below, so a correction is one edit and one command rather than a hunt
 * through the menu screen. It refuses to rebuild once any of the items have been sold, since order
 * lines reference them and the sold price is history.
 *
 * Sizes are ItemVariants and add-ons are ModifierGroups. Both price correctly at the till and are
 * snapshotted onto the order line, but note that neither has a create/edit API in the product yet —
 * they can only be written from here. Anything Spill wants changed about a *size* or an *add-on*
 * comes back to this script until that screen exists; ordinary items and prices they can edit
 * themselves on the menu screen.
 *
 *   npm run dev          # the script posts to the real signup endpoint
 *   SPILL_OWNER_PASSWORD=... npm run seed:spill
 *
 * Runs against whatever DATABASE_URL/DIRECT_URL is in the environment — development by default.
 */

const SLUG = "spill";
const TIER = "growth";
const BASE_URL = process.env.SPILL_BASE_URL ?? "http://localhost:3000";
const OWNER_EMAIL = process.env.SPILL_OWNER_EMAIL ?? "owner@spill.example";

async function buildMenu(tenantId: string) {
  const db = tenantDb(tenantId);

  const groupIdByKey = new Map<ModKey, string>();
  for (const [key, spec] of Object.entries(MOD_GROUPS) as [ModKey, (typeof MOD_GROUPS)[ModKey]][]) {
    const group = await db.modifierGroup.create({
      data: { tenantId, name: spec.name, minSelect: spec.min, maxSelect: spec.max },
    });
    groupIdByKey.set(key, group.id);
    let sortOrder = 0;
    for (const option of spec.options) {
      await db.modifier.create({
        data: {
          tenantId,
          groupId: group.id,
          name: option.name,
          priceDeltaPaisa: rs(option.price),
          sortOrder: sortOrder++,
        },
      });
    }
  }

  let categorySort = 0;
  let itemCount = 0;
  let variantCount = 0;

  for (const category of MENU) {
    const created = await db.category.create({
      data: { tenantId, name: category.name, sortOrder: categorySort++ },
    });

    for (const item of category.items) {
      // The star on the board marks Spill's own signatures. There is no schema field for it, so it
      // goes in the description where staff and the online menu both already show it, rather than
      // being dropped or smuggled into the item name where it would print on every receipt.
      const notes = [item.description, item.signature ? "Spill signature" : null].filter(Boolean);

      const menuItem = await db.menuItem.create({
        data: {
          tenantId,
          categoryId: created.id,
          name: item.name,
          basePricePaisa: rs(item.price),
          description: notes.length ? notes.join(" · ") : undefined,
        },
      });
      itemCount++;

      // Two sizes on the board become two variants, with 12oz as the base and 16oz priced as the
      // difference. Items with one price get no variants at all, so the till does not ask a
      // question that has only one answer.
      if (item.large !== undefined) {
        await db.itemVariant.create({
          data: { tenantId, menuItemId: menuItem.id, name: "12oz", priceDeltaPaisa: 0, isDefault: true, sortOrder: 0 },
        });
        await db.itemVariant.create({
          data: {
            tenantId,
            menuItemId: menuItem.id,
            name: "16oz",
            priceDeltaPaisa: rs(item.large - item.price),
            isDefault: false,
            sortOrder: 1,
          },
        });
        variantCount += 2;
      }

      for (const key of item.mods ?? []) {
        await db.menuItemModifierGroup.create({
          data: { tenantId, menuItemId: menuItem.id, groupId: groupIdByKey.get(key)! },
        });
      }
    }
  }

  return { categories: MENU.length, items: itemCount, variants: variantCount };
}

async function clearMenu(tenantId: string) {
  const db = tenantDb(tenantId);

  // Menu items are referenced by order lines, and a sold price is history — refuse rather than
  // cascade. A brand-new tenant has none, so this only ever bites once Spill is actually trading,
  // which is exactly when silently rewriting the menu would be the wrong thing to do.
  const sold = await db.orderLine.count();
  if (sold > 0) {
    throw new Error(
      `${SLUG} has ${sold} order line(s) against its menu. Refusing to rebuild it — edit prices on ` +
        `the menu screen instead, or clear the orders first if this is still a test tenant.`
    );
  }

  await db.recipeLine.deleteMany({});
  await db.branchMenuItem.deleteMany({});
  await db.menuItemModifierGroup.deleteMany({});
  await db.modifier.deleteMany({});
  await db.modifierGroup.deleteMany({});
  await db.itemVariant.deleteMany({});
  await db.menuItem.deleteMany({});
  await db.category.deleteMany({});
}

/**
 * Creates the tenant through the real public signup endpoint rather than writing the rows here.
 *
 * Provisioning is more than a Tenant row — it is the subscription, the first branch and its
 * settings, the Punjab PRA split-rate tax rules, the six roles, the expense categories and the
 * stock location that inventory silently needs. Re-implementing that list in a script is how it
 * drifts: the stock location was added to signup only yesterday, and a hand-rolled copy here would
 * already be wrong. So this posts to the same endpoint a customer would, against a running server,
 * and then makes exactly two deliberate adjustments a platform admin would otherwise click:
 * self-serve signup always starts a Starter trial, and Spill is a real client on Growth.
 *
 * Needs the app running — `npm run dev`, or SPILL_BASE_URL pointed at wherever it is.
 */
async function provisionViaSignup(): Promise<string> {
  const password = process.env.SPILL_OWNER_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SPILL_OWNER_PASSWORD to the password Spill's owner should start with. No default: a " +
        "committed one would be a published credential for a real client's account."
    );
  }

  const res = await fetch(`${BASE_URL}/api/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      restaurantName: "Spill",
      slug: SLUG,
      ownerName: "Spill Owner",
      ownerEmail: OWNER_EMAIL,
      ownerPassword: password,
      branchName: "Spill",
      city: process.env.SPILL_CITY,
    }),
  });
  if (!res.ok) {
    throw new Error(`Signup failed (${res.status}): ${await res.text()}`);
  }

  // Signup answers identically whether or not it created anything — that is what stops it being
  // used to enumerate accounts — so confirm against the database rather than trusting the 200.
  const tenant = await rawDb.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) {
    throw new Error(
      `Signup returned OK but no "${SLUG}" tenant exists. The usual cause is that ${OWNER_EMAIL} is ` +
        `already registered, which signup deliberately will not tell the caller about.`
    );
  }

  return tenant.id;
}

/**
 * Puts the tenant on its real plan. Separate from provisioning and safe to re-run, because the
 * first version of this script did it inline and left a half-built tenant behind when the next
 * statement threw — a script that cannot be run twice is a script you cannot fix a mistake with.
 *
 * Subscription is tenant-scoped, so it goes through tenantDb: rawDb connects as the RLS-bound
 * application role with no app.tenant_id set, which sees zero rows and reports the update as
 * "record not found" rather than as the permission problem it actually is.
 */
async function setPlan(tenantId: string) {
  const plan = await rawDb.plan.findUnique({ where: { key: TIER } });
  if (!plan) throw new Error(`The ${TIER} plan is not seeded — run \`npm run seed\` first.`);

  await tenantDb(tenantId).subscription.updateMany({ data: { planId: plan.id, trialEndsAt: null } });
  await rawDb.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
}

async function main() {
  const existing = await rawDb.tenant.findUnique({ where: { slug: SLUG } });

  let tenantId: string;
  let tempPassword: string | null = null;

  if (existing) {
    tenantId = existing.id;
    // An existing tenant with no menu is a previous run that died partway, not a tenant someone is
    // trading on — finish the job rather than demanding a flag to clean up after ourselves.
    const alreadyHasMenu = (await tenantDb(tenantId).menuItem.count()) > 0;
    if (alreadyHasMenu && !process.env.MENU_REPLACE) {
      console.log(
        `Tenant "${SLUG}" already has a menu. Re-run with MENU_REPLACE=1 to rebuild it from this file.`
      );
      return;
    }
    if (alreadyHasMenu) {
      console.log(`Rebuilding the menu for the existing "${SLUG}" tenant.`);
      await clearMenu(tenantId);
    } else {
      console.log(`Found "${SLUG}" with no menu — finishing the setup.`);
    }
  } else {
    tenantId = await provisionViaSignup();
    tempPassword = process.env.SPILL_OWNER_PASSWORD!;
    console.log(`Created tenant "${SLUG}".`);
  }

  await setPlan(tenantId);
  console.log(`On the ${TIER} plan, status ACTIVE.`);

  const counts = await buildMenu(tenantId);

  console.log(
    `Menu built: ${counts.categories} categories, ${counts.items} items, ${counts.variants} size variants.`
  );
  if (tempPassword) {
    console.log("");
    console.log(`  Sign in at ${BASE_URL}/login with restaurant "${SLUG}"`);
    console.log(`  Owner email  ${OWNER_EMAIL}`);
    console.log("  Password     the SPILL_OWNER_PASSWORD you set");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => rawDb.$disconnect());
