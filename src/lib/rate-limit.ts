import "server-only";
import { platformDb } from "@/server/db";

/**
 * Persistent (Postgres-backed) rate limiter — was an in-memory Map, which reset on every cold
 * start and didn't coordinate across serverless instances at all, making it close to useless in
 * production despite guarding public endpoints (signup, online-order checkout) and now the staff
 * PIN login too. RateLimitHit is platform-level (no RLS, not tenant data), so this reads/writes via
 * platformDb regardless of which tenant (if any) the caller belongs to.
 *
 * One row per hit rather than a counter, so the sliding-window semantics of the original
 * implementation carry over exactly: a key is limited if it has `maxHits` hits strictly newer than
 * `now - windowMs`. Old rows for the key are opportunistically deleted on each call so the table
 * doesn't grow unbounded — good enough at this volume; a scheduled sweep can be added later if it
 * ever needs to be more than incidental cleanup.
 */
export async function checkRateLimit(key: string, maxHits: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  const recentCount = await platformDb.rateLimitHit.count({ where: { key, createdAt: { gte: windowStart } } });
  if (recentCount >= maxHits) return false;

  await Promise.all([
    platformDb.rateLimitHit.create({ data: { key } }),
    platformDb.rateLimitHit.deleteMany({ where: { key, createdAt: { lt: windowStart } } }),
  ]);
  return true;
}
