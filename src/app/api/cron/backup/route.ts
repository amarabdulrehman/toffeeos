import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDatabaseBackup } from "@/server/backup";

// Same Bearer-auth contract as /api/cron/daily-summary — see vercel.json's `crons` entry for this
// path. Backing up 51 tables at this data volume takes well under a minute, but maxDuration is
// set explicitly since the Vercel default (10s) would cut it off partway through.
export const maxDuration = 60;

async function runBackupJob(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDatabaseBackup();
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}

export const GET = runBackupJob;
export const POST = runBackupJob;
