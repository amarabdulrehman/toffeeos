import { NextRequest, NextResponse } from "next/server";
import { platformDb } from "@/server/db";
import { env } from "@/lib/env";
import { getSettings } from "@/server/whatsapp/settings";
import { sendDailySummaryForAllBranches } from "@/server/whatsapp/triggers";
import { materialiseRecurringExpenses } from "@/server/expenses";

/**
 * The real scheduled job: meant to be hit once a day by an external scheduler with
 * `Authorization: Bearer <CRON_SECRET>`. Iterates every ACTIVE tenant — there's no per-tenant
 * session here, so it goes through platformDb (BYPASSRLS) rather than defineHandler, same
 * reasoning as the (platform) super-admin routes. Each branch computes its own "yesterday" in its
 * own timezone (src/server/whatsapp/triggers.ts), so calling this once daily from anywhere is
 * enough regardless of how many timezones the tenants span.
 *
 * Despite the name it now has a second responsibility: turning due RecurringExpense templates into
 * real Expense rows. That rides along here rather than getting its own Vercel cron entry because
 * Hobby caps both the number of crons and how often they may run, and this route plus the backup
 * job already spend that budget. The route keeps its original path deliberately — renaming a
 * registered cron means a window where vercel.json and the deployed route disagree.
 */
async function runDailySummary(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await platformDb.tenant.findMany({
    where: { status: { in: ["ACTIVE", "TRIALING"] } },
    select: { id: true, slug: true, subscription: { select: { enabledModules: true } } },
  });

  const now = new Date();

  const results = await Promise.all(
    tenants.map(async (tenant) => {
      // Runs before the WhatsApp early-return below, so recurring expenses still generate for the
      // majority of tenants who never turn WhatsApp on. Gated on the finance module so a tenant
      // downgraded off Growth stops accruing expense rows they can no longer see — without this,
      // a stale template would keep writing invisible entries until someone noticed.
      let generated = 0;
      let expenseError: string | undefined;
      if (tenant.subscription?.enabledModules.includes("finance")) {
        try {
          generated = await materialiseRecurringExpenses(tenant.id, now);
        } catch (err) {
          // Deliberately swallowed per-tenant: this whole loop is a single Promise.all, so letting
          // one tenant's failure reject would abort every other tenant's summary and generation too.
          expenseError = err instanceof Error ? err.message : String(err);
        }
      }

      const settings = await getSettings(tenant.id);
      if (!settings.enabled || !settings.dailySummaryEnabled) {
        return { tenant: tenant.slug, skipped: true, generated, expenseError };
      }
      const branchResults = await sendDailySummaryForAllBranches(tenant.id);
      return { tenant: tenant.slug, skipped: false, branches: branchResults.length, generated, expenseError };
    })
  );

  return NextResponse.json({ ranAt: now.toISOString(), results });
}

// Vercel Cron always invokes via GET (and auto-attaches `Authorization: Bearer $CRON_SECRET` when
// that env var is set — see vercel.json's `crons` entry for this path). POST is kept for any
// other scheduler (cron-job.org, etc.) that prefers it — same auth check either way.
export const GET = runDailySummary;
export const POST = runDailySummary;
