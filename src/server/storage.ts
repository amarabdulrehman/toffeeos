import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Phase 1 planned Supabase Storage for images but never actually created a bucket or upload path
 * — this is that gap, filled now because delivery proof-of-drop needs it. Bucket is private (not
 * public): delivery photos are tenant data, so the client never gets a bare public URL, only a
 * short-lived signed URL minted per request (see getDeliveryProofSignedUrl below).
 */
const DELIVERY_PROOFS_BUCKET = "delivery-proofs";

// Lazy for the same reason as src/server/realtime.ts: supabase-js throws on an undefined URL or
// key, and `next build` imports this module in an environment where Vercel's Sensitive env vars do
// not exist. See src/lib/env.ts.
let storageClient: ReturnType<typeof createClient> | undefined;
function getStorageClient() {
  storageClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return storageClient;
}

let bucketEnsured = false;

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets } = await getStorageClient().storage.listBuckets();
  if (!buckets?.some((b) => b.name === DELIVERY_PROOFS_BUCKET)) {
    const { error } = await getStorageClient().storage.createBucket(DELIVERY_PROOFS_BUCKET, {
      public: false,
      fileSizeLimit: "5MB",
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    // A concurrent request may have created it first — only a real failure should throw.
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketEnsured = true;
}

/** Stores the photo under `{tenantId}/{orderId}-{timestamp}.{ext}` and returns the storage path
 * (not a URL) — callers persist the path on Order.deliveryProofUrl and resolve it to a signed URL
 * only when actually displaying it. */
export async function uploadDeliveryProof(
  tenantId: string,
  orderId: string,
  file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }
): Promise<string> {
  await ensureBucket();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${tenantId}/${orderId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await getStorageClient().storage
    .from(DELIVERY_PROOFS_BUCKET)
    .upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw new Error(`Failed to upload delivery proof: ${error.message}`);

  return path;
}

export async function getDeliveryProofSignedUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await getStorageClient().storage
    .from(DELIVERY_PROOFS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

// ============================================================================
// Tenant logo (receipts + the public storefront)
// ============================================================================

/**
 * Public, unlike delivery proofs above. A logo is already public branding — it renders on the
 * unauthenticated storefront — and a receipt is printed from the browser, where a short-lived
 * signed URL would expire and leave a broken image on the paper. Nothing tenant-private lives here.
 */
const TENANT_LOGOS_BUCKET = "tenant-logos";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

let logoBucketEnsured = false;
async function ensureLogoBucket(): Promise<void> {
  if (logoBucketEnsured) return;
  const { data: buckets } = await getStorageClient().storage.listBuckets();
  if (!buckets?.some((b) => b.name === TENANT_LOGOS_BUCKET)) {
    const { error } = await getStorageClient().storage.createBucket(TENANT_LOGOS_BUCKET, {
      public: true,
      fileSizeLimit: `${MAX_LOGO_BYTES}`,
      allowedMimeTypes: ALLOWED_LOGO_TYPES,
    });
    // A concurrent request may have created it first — only a real failure should throw.
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  logoBucketEnsured = true;
}

/**
 * Stores the tenant's logo and returns a permanent public URL to put in Tenant.logoUrl.
 *
 * The object key is keyed on tenantId with a cache-busting timestamp: re-uploading replaces the
 * logo everywhere it is shown without the browser (or a print preview) serving a stale cached copy.
 */
export async function uploadTenantLogo(
  tenantId: string,
  file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
): Promise<string> {
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    throw new Error("Logo must be a PNG, JPEG, WebP, or SVG image.");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("Logo must be 2MB or smaller.");
  }

  await ensureLogoBucket();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${tenantId}/logo-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await getStorageClient()
    .storage.from(TENANT_LOGOS_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (error) throw new Error(`Failed to upload logo: ${error.message}`);

  const { data } = getStorageClient().storage.from(TENANT_LOGOS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
