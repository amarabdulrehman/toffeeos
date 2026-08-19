import { NextRequest, NextResponse } from "next/server";
import { platformDb } from "@/server/db";
import { env } from "@/lib/env";
import { getSettings } from "@/server/whatsapp/settings";
import { sendDailySummaryForAllBranches } from "@/server/whatsapp/triggers";

/**
 * The real scheduled job: meant to be hit once a day by an external scheduler (Vercel Cron,
 * cron-job.org, etc.) with `Authorization: Bearer <CRON_SECRET>`. Iterates every ACTIVE tenant —
 * there's no per-tenant session here, so it goes through platformDb (BYPASSRLS) rather than
 * defineHandler, same reasoning as the (platform) super-admin routes. Each branch computes its own
 * "yesterday" in its own timezone (src/server/whatsapp/triggers.ts), so calling this once daily
 * from anywhere is enough regardless of how many timezones the tenants span.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await platformDb.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIALING"] } }, select: { id: true, slug: true } });

  const results = await Promise.all(
    tenants.map(async (tenant) => {
      const settings = await getSettings(tenant.id);
      if (!settings.enabled || !settings.dailySummaryEnabled) {
        return { tenant: tenant.slug, skipped: true };
      }
      const branchResults = await sendDailySummaryForAllBranches(tenant.id);
      return { tenant: tenant.slug, skipped: false, branches: branchResults.length };
    })
  );

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
