import "dotenv/config";
import { MENU, MOD_GROUPS, rs, type ModKey } from "./spill-menu";

/**
 * Builds Spill on a deployment we have no database credentials for.
 *
 * The original seeder writes sizes and add-ons straight to the database, because at the time there
 * was no other way to create them. There is now: the variants and modifier-group routes shipped
 * tonight, so the entire menu can be built over HTTP by a signed-in owner, and production's
 * connection string never has to leave Vercel.
 *
 * Everything here is a request a person could make through the product. Nothing is written that the
 * owner could not have typed in themselves — which is the point, because it means what this
 * produces is exactly what they will see and be able to edit.
 *
 *   SPILL_BASE_URL=https://toffeeos.com SPILL_OWNER_EMAIL=... SPILL_OWNER_PASSWORD=... \
 *     npx tsx prisma/create-spill-remote.ts
 *
 * The one thing it cannot do is set the plan: self-serve signup always starts a Starter trial, and
 * moving a tenant to Growth is a platform-admin action. It says so at the end rather than pretending
 * otherwise.
 */

const BASE = (process.env.SPILL_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SLUG = process.env.SPILL_SLUG ?? "spill";
const EMAIL = process.env.SPILL_OWNER_EMAIL;
const PASSWORD = process.env.SPILL_OWNER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Set SPILL_OWNER_EMAIL and SPILL_OWNER_PASSWORD.");
  process.exit(1);
}

/** One cookie jar for the whole run, so signing in sticks across every later call. */
const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + path, {
    ...init,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return res;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await req(path, { method: "POST", body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function put(path: string, body: unknown): Promise<void> {
  const res = await req(path, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  console.log(`Target: ${BASE}`);

  // 1. The tenant, through the public signup a customer would use.
  const status = await (await req(`/api/tenants/${SLUG}/status`)).json();
  if (status.status) {
    console.log(`Tenant "${SLUG}" already exists (${status.status}) — not signing up again.`);
  } else {
    await post("/api/signup", {
      restaurantName: "Spill",
      slug: SLUG,
      ownerName: "Spill Owner",
      ownerEmail: EMAIL,
      ownerPassword: PASSWORD,
      branchName: "Spill",
      city: process.env.SPILL_CITY,
    });
    // Signup answers identically whether or not it created anything — that is what stops it being
    // used to enumerate accounts — so confirm rather than trust the 200.
    const after = await (await req(`/api/tenants/${SLUG}/status`)).json();
    if (!after.status) {
      throw new Error(
        `Signup returned OK but no "${SLUG}" tenant exists. Usually means ${EMAIL} is already ` +
          `registered, which signup deliberately will not say.`
      );
    }
    console.log(`Created tenant "${SLUG}" (${after.status}).`);
  }

  // 2. Sign in as the owner. Everything after this is an ordinary authenticated request.
  const { csrfToken } = await (await req("/api/auth/csrf")).json();
  await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tenantSlug: SLUG, email: EMAIL!, password: PASSWORD!, csrfToken, json: "true" }).toString(),
  });
  const session = await (await req("/api/auth/session")).json();
  if (!session?.user) throw new Error("Could not sign in as the owner after signup.");
  console.log(`Signed in as ${session.user.email}.`);

  // 3. Add-on groups first: items reference them.
  const existingGroups = (await (await req("/api/modifier-groups")).json()).groups as { id: string; name: string }[];
  const groupIdByKey = new Map<ModKey, string>();

  for (const [key, spec] of Object.entries(MOD_GROUPS) as [ModKey, (typeof MOD_GROUPS)[ModKey]][]) {
    const already = existingGroups.find((g) => g.name.toLowerCase() === spec.name.toLowerCase());
    if (already) {
      groupIdByKey.set(key, already.id);
      continue;
    }
    const created = (await post("/api/modifier-groups", {
      name: spec.name,
      minSelect: spec.min,
      maxSelect: spec.max,
    })) as { group: { id: string } };
    groupIdByKey.set(key, created.group.id);

    for (const option of spec.options) {
      await post(`/api/modifier-groups/${created.group.id}/modifiers`, {
        name: option.name,
        priceDeltaPaisa: rs(option.price),
      });
    }
  }
  console.log(`Add-on groups: ${groupIdByKey.size}.`);

  // 4. The menu itself.
  const menu = (await (await req("/api/menu")).json()) as {
    categories: { id: string; name: string; items: { name: string }[] }[];
  };
  const categoryIdByName = new Map(menu.categories.map((c) => [c.name, c.id]));
  const existingItems = new Set(menu.categories.flatMap((c) => c.items.map((i) => `${c.name}::${i.name}`)));

  let items = 0;
  let variants = 0;

  for (const category of MENU) {
    let categoryId = categoryIdByName.get(category.name);
    if (!categoryId) {
      const created = (await post("/api/menu", { name: category.name })) as { id?: string; category?: { id: string } };
      categoryId = created.id ?? created.category!.id;
      categoryIdByName.set(category.name, categoryId);
    }

    for (const item of category.items) {
      // Re-runnable: skip anything already on the menu rather than creating a second copy. Names
      // repeat across categories ("Vanilla" is a coffee, a frappe and a matcha), so the key has to
      // include the category.
      if (existingItems.has(`${category.name}::${item.name}`)) continue;

      const notes = [item.description, item.signature ? "Spill signature" : null].filter(Boolean);
      const created = (await post("/api/menu-items", {
        categoryId,
        name: item.name,
        basePricePaisa: rs(item.price),
        ...(notes.length ? { description: notes.join(" · ") } : {}),
      })) as { id?: string; item?: { id: string } };
      const menuItemId = created.item?.id ?? created.id!;
      items++;

      if (item.large !== undefined) {
        // Absolute prices, which is what the variants route takes — it converts to the stored delta.
        await post(`/api/menu-items/${menuItemId}/variants`, { name: "12oz", pricePaisa: rs(item.price) });
        await post(`/api/menu-items/${menuItemId}/variants`, { name: "16oz", pricePaisa: rs(item.large) });
        variants += 2;
      }

      const groupIds = (item.mods ?? []).map((k) => groupIdByKey.get(k)!).filter(Boolean);
      if (groupIds.length > 0) {
        await put(`/api/menu-items/${menuItemId}/modifier-groups`, { groupIds });
      }
    }
  }

  console.log(`Menu built: ${MENU.length} categories, ${items} items, ${variants} size variants.`);
  console.log("");
  console.log(`  Sign in at ${BASE}/login with restaurant "${SLUG}"`);
  console.log(`  Owner: ${EMAIL}`);
  console.log("");
  console.log("  Still to do by hand:");
  console.log("   - move the tenant to its real plan (signup always starts a Starter trial)");
  console.log("   - set the branch's discount ceiling (it defaults to 100%, i.e. no limit)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
