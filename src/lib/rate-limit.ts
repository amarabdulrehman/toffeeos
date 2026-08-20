import "server-only";

/**
 * DEV-ONLY in-memory rate limiter — same caveats as otp-store.ts: per-process, won't survive a
 * redeploy, doesn't coordinate across multiple server instances. Good enough to blunt naive abuse
 * of the public (unauthenticated) online-ordering checkout endpoint in this environment; replace
 * with a real store (Redis, Upstash) before going live with actual internet traffic.
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, maxHits: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= maxHits) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
