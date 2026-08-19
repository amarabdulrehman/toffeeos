import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { auth } from "@/server/auth";
import { tenantDb } from "@/server/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { TenantSessionUser } from "@/server/auth/types";

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
  input?: TSchema;
  /** Return null to skip logging for a particular call (e.g. a no-op update). */
  audit?: (input: TSchema["_output"], result: unknown) => AuditInfo | null;
}

class HttpError extends Error {
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

      const db = tenantDb(user.tenantId);
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

      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, issues: err.issues }, { status: err.status });
      }
      console.error(err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
