import "server-only";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { ZodType } from "zod";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { TenantSessionUser } from "@/server/auth/types";
import { tenantAcceptsLogin } from "@/server/auth/session-user";
import { getTenantGate, moduleForPermission } from "@/server/tier";

/**
 * The single choke point every tenant-facing API route goes through: resolves the session,
 * enforces the required permission, validates input, hands the handler a tenant-scoped Prisma
 * client, and writes an audit log entry for mutations. Route handlers should never import
 * tenantDb/rawDb directly — going through here is what keeps "every mutation is audited" and
 * "every permission is actually checked" true as the API surface grows, instead of something each
 * route author has to remember.
 */
export interface HandlerContext<TInput> {
  session: TenantSessionUser;
  db: PrismaClient;
  input: TInput;
  req: NextRequest;
  /** Dynamic route segments, e.g. { orderId: "..." } for /api/orders/[orderId]/... */
  params: Record<string, string>;
}

export interface AuditInfo {
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface DefineHandlerOptions<TSchema extends ZodType> {
  /** A key from src/server/permissions/registry.ts. Omit only for routes any signed-in staff member may hit. */
  permission?: string;
  /**
   * Overrides which gateable module (see GATEABLE_MODULES in src/lib/tiers.ts) this route belongs
   * to, when `permission`'s own module (its string before the first ".") doesn't match — e.g.
   * tenant-branding is gated by the broad `settings.general.manage` permission but is specifically
   * an Online Ordering feature. Only needed for that kind of mismatch; leave unset otherwise, since
   * `permission` already infers the right module for the vast majority of routes.
   */
  tierModule?: string;
  input?: TSchema;
  /** Return null to skip logging for a particular call (e.g. a no-op update). */
  audit?: (input: TSchema["_output"], result: unknown) => AuditInfo | null;
}

/** Exported so business-logic modules (e.g. src/server/delivery.ts's "not your order" check) can
 * throw a specific status code instead of falling through to defineHandler's generic 500. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public issues?: unknown) {
    super(message);
  }
}

type RouteContext = { params: Promise<Record<string, string>> };

export function defineHandler<TSchema extends ZodType = ZodType<undefined>>(
  options: DefineHandlerOptions<TSchema>,
  fn: (ctx: HandlerContext<TSchema["_output"]>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx?: RouteContext) => {
    try {
      const params = (await routeCtx?.params) ?? {};
      const session = await auth();
      if (!session?.user || session.user.kind !== "tenant") {
        throw new HttpError(401, "Unauthorized");
      }
      const user = session.user;

      if (options.permission && !user.permissions.includes(options.permission)) {
        throw new HttpError(403, `Missing permission: ${options.permission}`);
      }

      const db = tenantDb(user.tenantId);

      // One query for two checks that both need to be fresh on every request (neither is cached on
      // the session): suspension/cancellation only ever blocked new *logins* before this — an
      // already-issued JWT session kept working against every API route until it naturally expired
      // — and a platform admin's tier change must take effect on the tenant's very next call, not
      // require a re-login. Originally two separate round trips; consolidated after measuring real,
      // consistent per-request latency against this app's remote Postgres (~1.3s sequential, not a
      // dev-compile artifact) — this is a genuine fix, not premature optimization.
      const gate = await getTenantGate(db);
      if (!gate.tenantStatus || !tenantAcceptsLogin(gate.tenantStatus)) {
        throw new HttpError(403, "This restaurant's account is no longer active.");
      }
      if (options.permission) {
        const moduleKey = moduleForPermission(options.tierModule ?? options.permission);
        if (moduleKey && !gate.enabledModules.includes(moduleKey)) {
          throw new HttpError(403, "This feature isn't enabled for this restaurant. Contact your platform admin.");
        }
      }

      let input: TSchema["_output"] = undefined as TSchema["_output"];
      if (options.input) {
        const raw =
          req.method === "GET"
            ? Object.fromEntries(req.nextUrl.searchParams.entries())
            : await req.json().catch(() => ({}));
        const parsed = options.input.safeParse(raw);
        if (!parsed.success) {
          throw new HttpError(400, "Invalid input", parsed.error.issues);
        }
        input = parsed.data;
      }

      const result = await fn({ session: user, db, input, req, params });

      if (options.audit) {
        const info = options.audit(input, result);
        if (info) {
          await db.auditLog.create({
            data: {
              branchId: user.branchId,
              actorId: user.id,
              action: info.action,
              entityType: info.entityType,
              entityId: info.entityId,
              metadata: info.metadata as Prisma.InputJsonValue | undefined,
            },
          });
        }
      }

      // Lets a handler return a NextResponse directly (e.g. a route that needs to branch on
      // content-type, like multipart file uploads) instead of always being wrapped in another
      // NextResponse.json() call.
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, issues: err.issues }, { status: err.status });
      }
      // A row a handler expected to exist (findUniqueOrThrow/update/delete on a bare `where: { id }`)
      // wasn't visible to this session — either it genuinely doesn't exist, or (just as often, given
      // the RLS-bound tenant scoping) it belongs to a different tenant/branch and was correctly
      // filtered out at the database layer. Either way that's a 404 to the caller, not a crash.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Only genuinely unexpected errors reach here — HttpError and the P2025 case above are both
      // handled (expected) outcomes, not incidents. This is the one place a real client's 500 was
      // previously invisible unless they personally reported it.
      Sentry.captureException(err);
      console.error(err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
