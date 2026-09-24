import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every permission in the registry should actually gate something.
 *
 * The staff/roles screen renders itself from PERMISSIONS_BY_MODULE, so an owner sees and can
 * toggle every key declared there. A key nothing checks is worse than a missing feature: the owner
 * believes they have denied "Issue a refund" and they have not. It is a promise the UI makes and
 * the server does not keep.
 *
 * This does not demand that the list be empty today — 27 keys are unenforced, all of them for
 * features not yet built, and deciding which to wire up, hide or delete is a product call. What it does is
 * stop the number growing: add a permission without enforcing it and this fails, so the decision
 * gets made at the moment the key is introduced rather than discovered by a client.
 *
 * Reads the files as text. src/server/** imports `server-only`, which throws under vitest.
 */

const SRC = path.join(__dirname, "..", "src");

/** Keys the registry declares that nothing currently enforces. Shrink this list; never grow it. */
const KNOWN_UNENFORCED = new Set([
  // Features not built yet — the permission was written alongside the schema.
  "billing.plan.change",
  "billing.view",
  "crm.allergen.manage",
  "crm.loyalty.adjust",
  "inventory.adjustment.delete",
  "inventory.lowStockAlert.configure",
  "inventory.purchaseOrder.approve",
  "inventory.purchaseOrder.create",
  "inventory.supplier.manage",
  "inventory.transfer.approve",
  "kds.order.recall",
  "menu.priceOverride",
  "online.menu.manage",
  "online.qr.manage",
  "orders.markPaid",
  "pos.cashDrawer.openNoSale",
  "pos.order.changeType",
  "pos.order.voidLine",
  "pos.pin.bypassVerification",
  "pos.shift.bypassTimeRestriction",
  "pos.tax.edit",
  "pos.tax.exempt",
  "reports.export",
  "reports.profit.view",
  "settings.serviceCharge.manage",
  "staff.roles.manage",
  "tables.merge",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|generated|\.next/.test(p)) sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function declaredPermissions(): Set<string> {
  const reg = readFileSync(path.join(SRC, "server/permissions/registry.ts"), "utf8");
  // Keys are composed: perm(module, action, label) -> `${module}.${action}`
  return new Set([...reg.matchAll(/perm\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)].map((m) => `${m[1]}.${m[2]}`));
}

function enforcedPermissions(): Set<string> {
  const used = new Set<string>();
  for (const f of sourceFiles(SRC)) {
    if (f.endsWith("registry.ts")) continue;
    const c = readFileSync(f, "utf8");
    for (const m of c.matchAll(
      /permission:\s*"([^"]+)"|perm=\{?"([^"]+)"|hasPermission\([^,]+,\s*"([^"]+)"|permissions\.includes\("([^"]+)"\)/g
    )) {
      const p = m[1] || m[2] || m[3] || m[4];
      if (p?.includes(".")) used.add(p);
    }
  }
  return used;
}

describe("permission registry", () => {
  const declared = declaredPermissions();
  const enforced = enforcedPermissions();

  it("parsed both sides — a broken regex must not pass this file vacuously", () => {
    expect(declared.size).toBeGreaterThan(80);
    expect(enforced.size).toBeGreaterThan(50);
    expect(declared.has("pos.access")).toBe(true);
    expect(enforced.has("pos.access")).toBe(true);
  });

  it("enforces no permission that the registry does not declare", () => {
    // The dangerous direction: a typo in a `permission:` string is a check that can never pass,
    // and the route is silently unreachable for everyone.
    const ghosts = [...enforced].filter((p) => !declared.has(p)).sort();
    expect(ghosts, `checked in code but absent from the registry:\n  ${ghosts.join("\n  ")}`).toEqual([]);
  });

  it("introduces no new permission that nothing enforces", () => {
    const unenforced = [...declared].filter((p) => !enforced.has(p));
    const novel = unenforced.filter((p) => !KNOWN_UNENFORCED.has(p)).sort();

    expect(
      novel,
      "These are grantable in the roles UI and gate nothing. Either enforce them, or add them to " +
        `KNOWN_UNENFORCED with a reason:\n  ${novel.join("\n  ")}`
    ).toEqual([]);
  });

  it("keeps the known-unenforced list honest as permissions get wired up", () => {
    // If a key on the list has since been enforced, the list is stale — take it off, so the list
    // stays an accurate account of what is still outstanding rather than accumulating dead entries.
    const nowEnforced = [...KNOWN_UNENFORCED].filter((p) => enforced.has(p)).sort();
    expect(
      nowEnforced,
      `now enforced — remove from KNOWN_UNENFORCED:\n  ${nowEnforced.join("\n  ")}`
    ).toEqual([]);
  });
});
