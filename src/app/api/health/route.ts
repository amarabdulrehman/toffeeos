import { NextResponse } from "next/server";
import { rawDb } from "@/server/db";

/**
 * GET /api/health — for an uptime monitor.
 *
 * Point any free monitor (UptimeRobot, Better Stack, cron-job.org) at this and have it alert on
 * anything but a 200. It proves the two things a till needs: the app is serving, and the database
 * answers. A home page can load fine from cache while every order fails, which is why the
 * database is asked too.
 *
 * Public, and deliberately says nothing a stranger could use: no version, no hostnames, no error
 * text — only up or down. The query is a constant, so hitting this costs the database nothing.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await rawDb.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "up" }, { headers });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503, headers });
  }
}
