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
