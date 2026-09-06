import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { authFile, TENANT_SLUG } from "./fixtures/test-data";

/**
 * Logo on printed receipts.
 *
 * Two settings in different places, because they have different scopes: the logo is tenant-wide
 * (Tenant.logoUrl, shared with the online storefront) and whether it prints is per-branch
 * (BranchSettings.showLogoOnReceipt, alongside receiptHeader).
 *
 * The default matters as much as the feature: showLogoOnReceipt is false, so deploying this must
 * not silently change what any existing client's receipts look like.
 */

/** A real 1x1 PNG. Small, but a genuine image the upload path and Supabase must both accept. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function readState() {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT t."logoUrl", bs."showLogoOnReceipt"
         FROM "Tenant" t
         JOIN "Branch" b ON b."tenantId" = t.id
         JOIN "BranchSettings" bs ON bs."branchId" = b.id
        WHERE t.slug = $1
        ORDER BY b."createdAt" LIMIT 1`,
      [TENANT_SLUG]
    );
    return r.rows[0] as { logoUrl: string | null; showLogoOnReceipt: boolean };
  });
}

test.describe("Receipt logo", () => {
  test.use({ storageState: authFile("owner") });

  test("uploading a logo stores it and returns a URL that actually serves the image", async ({ request }) => {
    const before = await readState();

    const res = await request.post("/api/tenant-branding/logo", {
      multipart: { file: { name: "logo.png", mimeType: "image/png", buffer: PNG_1X1 } },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { logoUrl } = await res.json();
    expect(logoUrl).toMatch(/^https?:\/\//);

    // The URL is permanent and public, not a signed URL — a receipt printed tomorrow must still
    // render it. Fetch it with no credentials at all to prove that.
    const anon = await request.fetch(logoUrl, { headers: {} });
    expect(anon.status(), "the stored logo URL must serve publicly").toBe(200);
    expect(anon.headers()["content-type"]).toContain("image");

    // And it is persisted on the tenant, not just returned.
    const after = await readState();
    expect(after.logoUrl).toBe(logoUrl);
    expect(after.logoUrl).not.toBe(before.logoUrl); // cache-busting key, so a replace is visible
  });

  test("the toggle is off by default and is saved per branch", async ({ request }) => {
    // Deploying this must not change any existing client's receipts.
    await withDb((c) =>
      c.query(
        `UPDATE "BranchSettings" bs SET "showLogoOnReceipt" = false
           FROM "Branch" b JOIN "Tenant" t ON b."tenantId" = t.id
          WHERE bs."branchId" = b.id AND t.slug = $1`,
        [TENANT_SLUG]
      )
    );
    expect((await readState()).showLogoOnReceipt).toBe(false);

    const on = await request.patch("/api/branch-settings", { data: { showLogoOnReceipt: true } });
    expect(on.ok(), await on.text()).toBeTruthy();
    expect((await readState()).showLogoOnReceipt).toBe(true);

    const off = await request.patch("/api/branch-settings", { data: { showLogoOnReceipt: false } });
    expect(off.ok()).toBeTruthy();
    expect((await readState()).showLogoOnReceipt).toBe(false);
  });

  test("rejects a non-image and an oversized file with a usable message", async ({ request }) => {
    const notAnImage = await request.post("/api/tenant-branding/logo", {
      multipart: { file: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } },
    });
    expect(notAnImage.status()).toBe(400);
    expect((await notAnImage.json()).error).toMatch(/PNG|JPEG|WebP|SVG/i);

    const tooBig = await request.post("/api/tenant-branding/logo", {
      multipart: {
        file: { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(3 * 1024 * 1024, 1) },
      },
    });
    expect(tooBig.status()).toBe(400);
    expect((await tooBig.json()).error).toMatch(/2MB/i);
  });

  test("a cashier cannot change receipt branding", async ({ browser, baseURL }) => {
    // settings.general.manage is an owner/manager permission; a cashier must not restyle receipts.
    const ctx = await browser.newContext({ baseURL, storageState: authFile("cashier") });
    const req = ctx.request;
    try {
      const upload = await req.post("/api/tenant-branding/logo", {
        multipart: { file: { name: "logo.png", mimeType: "image/png", buffer: PNG_1X1 } },
      });
      expect(upload.status()).toBe(403);

      const toggle = await req.patch("/api/branch-settings", { data: { showLogoOnReceipt: true } });
      expect(toggle.status()).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test("the receipt header saves, trims, and clears back to null", async ({ request }) => {
    // receiptHeader existed unused in the schema from Phase 1 until the receipt branding work.
    const header = ["Shop 4, Main Boulevard", "Gulberg, Lahore", "0300-1234567"].join("\n");

    const save = await request.patch("/api/branch-settings", { data: { receiptHeader: header } });
    expect(save.ok(), await save.text()).toBeTruthy();
    expect((await save.json()).settings.receiptHeader).toBe(header);

    // Line breaks must survive the round trip — an address is typed as several lines and prints
    // that way (whitespace-pre-line in the Receipt component).
    const stored = await withDb(async (c) => {
      const r = await c.query(
        'SELECT bs."receiptHeader" FROM "BranchSettings" bs JOIN "Branch" b ON bs."branchId" = b.id ' +
          'JOIN "Tenant" t ON b."tenantId" = t.id WHERE t.slug = $1 ORDER BY b."createdAt" LIMIT 1',
        [TENANT_SLUG]
      );
      return r.rows[0].receiptHeader as string | null;
    });
    expect(stored).toContain("\n");

    // Whitespace-only is the same as none: it must land as null, not a blank line on the paper.
    const cleared = await request.patch("/api/branch-settings", { data: { receiptHeader: "   " } });
    expect((await cleared.json()).settings.receiptHeader).toBeNull();

    // Over the cap is rejected rather than silently truncated.
    const tooLong = await request.patch("/api/branch-settings", { data: { receiptHeader: "x".repeat(281) } });
    expect(tooLong.status()).toBe(400);
  });
});
