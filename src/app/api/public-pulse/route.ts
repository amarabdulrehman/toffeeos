import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { platformDb } from "@/server/db";

/**
 * GET /api/public-pulse: an anonymous production heartbeat for the portfolio site.
 *
 * Returns platform-wide totals only, never per-restaurant figures, names or customer data:
 *   - dailyOrders: orders created in the last 24h across ACTIVE tenants (deleted, voided and
 *     cancelled ones excluded)
 *   - avgDailyOrders30d: the same count over the last 30 days, divided by 30 (one decimal)
 *   - failedSyncs: SyncConflicts raised in the last 24h, i.e. offline replays the sync engine
 *     refused to apply automatically
 *
 * Uses platformDb because the totals span tenants. Same rule as the cron routes: only a caller
 * holding `Authorization: Bearer <PULSE_TOKEN>` gets an answer; unset PULSE_TOKEN rejects everyone.
 */
export const dynamic = "force-dynamic";

const EXCLUDED = ["DELETED", "VOIDED", "CANCELLED"] as const;

function authorized(header: string | null) {
  const token = env.PULSE_TOKEN;
  if (!token || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }

  const DAY = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - DAY);
  const since30 = new Date(Date.now() - 30 * DAY);
  try {
    const tenants = await platformDb.tenant.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    const tenantId = { in: tenants.map((t) => t.id) };
    const [dailyOrders, orders30d, failedSyncs] = await Promise.all([
      platformDb.order.count({ where: { tenantId, createdAt: { gte: since }, status: { notIn: [...EXCLUDED] } } }),
      platformDb.order.count({ where: { tenantId, createdAt: { gte: since30 }, status: { notIn: [...EXCLUDED] } } }),
      platformDb.syncConflict.count({ where: { tenantId, createdAt: { gte: since } } }),
    ]);
    return NextResponse.json(
      {
        status: "operational",
        dailyOrders,
        avgDailyOrders30d: Math.round((orders30d / 30) * 10) / 10,
        failedSyncs,
        updatedAt: new Date().toISOString(),
      },
      { headers },
    );
  } catch {
    // reachable but the database isn't answering: say so without leaking detail
    return NextResponse.json({ status: "down", dailyOrders: 0, failedSyncs: null, updatedAt: new Date().toISOString() }, { status: 503, headers });
  }
}
