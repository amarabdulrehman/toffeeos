import "server-only";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { ZodType } from "zod";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db";
import { HttpError } from "@/server/handler";
import type { PlatformSessionUser } from "@/server/auth/types";

/** Same shape as defineHandler, but for (platform) super-admin routes: requires kind === "platform"
 * and hands the handler platformDb (the BYPASSRLS connection), never a tenant-scoped client. */
export interface PlatformHandlerContext<TInput> {
  session: PlatformSessionUser;
  input: TInput;
  req: NextRequest;
  /** Dynamic route segments, e.g. { tenantId: "..." } for /api/platform/tenants/[tenantId]/... */
  params: Record<string, string>;
}

/** Re-exported (not redefined) from src/server/handler.ts on purpose — this file used to declare
 * its own separate `HttpError` class with the same name and shape. Since src/server/platform.ts
 * and src/server/billing.ts both throw @/server/handler's HttpError (the one defineHandler-based
 * tenant routes use), every `catch (err) { if (err instanceof HttpError) ... }` check below was
 * comparing against the WRONG class — two different classes, same name, so `instanceof` always
 * failed and every intentional HttpError (404s, validation errors, the branch-limit-on-downgrade
 * check) silently fell through to a generic 500 "Internal error" instead of its real status and
 * message. A single canonical HttpError, used by both defineHandler and definePlatformHandler,
 * is what makes `instanceof` actually work regardless of which one catches it. */
export { HttpError };

type RouteContext = { params: Promise<Record<string, string>> };

export function definePlatformHandler<TSchema extends ZodType = ZodType<undefined>>(
  options: { input?: TSchema },
  fn: (ctx: PlatformHandlerContext<TSchema["_output"]>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx?: RouteContext) => {
    try {
      const params = (await routeCtx?.params) ?? {};
      const session = await auth();
      if (!session?.user || session.user.kind !== "platform") {
        throw new HttpError(401, "Unauthorized");
      }

      let input: TSchema["_output"] = undefined as TSchema["_output"];
      if (options.input) {
        const raw =
          req.method === "GET"
            ? Object.fromEntries(req.nextUrl.searchParams.entries())
            : await req.json().catch(() => ({}));
        const parsed = options.input.safeParse(raw);
        if (!parsed.success) throw new HttpError(400, "Invalid input", parsed.error.issues);
        input = parsed.data;
      }

      const result = await fn({ session: session.user, input, req, params });
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, issues: err.issues }, { status: err.status });
      }
      Sentry.captureException(err);
      console.error(err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export { platformDb };
