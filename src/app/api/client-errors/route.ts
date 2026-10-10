import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  section: z.string().min(1).max(80),
  message: z.string().max(500),
  name: z.string().max(80).optional(),
  stack: z.string().max(4000).optional(),
  path: z.string().max(200).optional(),
});

/**
 * POST /api/client-errors — a screen that crashed in the browser, reported through the server.
 *
 * The browser ships no Sentry SDK (next.config.ts leaves it out unless NEXT_PUBLIC_SENTRY_DSN is
 * set, for the blocking time it cost a slow café tablet), so a crash on the till reached nobody:
 * on 9 October 2026 a café's POS fell over on and off mid-service and Sentry held nothing but
 * server errors. The error screens now post what they caught here, and the server — whose Sentry
 * client is set up — files it, tagged as coming from the browser.
 *
 * Signed-in staff only, and limited per person, so it can't be used to fill Sentry.
 */
export const POST = defineHandler({ input: schema }, async ({ session, input }) => {
  if (!(await checkRateLimit(`client-error:${session.id}`, 20, 10 * 60 * 1000))) return { ok: false };

  const error = new Error(input.message || "Unknown browser error");
  error.name = input.name ?? "BrowserError";
  if (input.stack) error.stack = input.stack;
  Sentry.captureException(error, {
    tags: { source: "browser", section: input.section, tenantId: session.tenantId },
    extra: { path: input.path, branchId: session.branchId },
  });
  console.error(`[browser:${input.section}] ${error.name}: ${error.message} (${input.path ?? ""})`);
  return { ok: true };
});
