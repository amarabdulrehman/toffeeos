import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db";
import type { PlatformSessionUser } from "@/server/auth/types";

/** Same shape as defineHandler, but for (platform) super-admin routes: requires kind === "platform"
 * and hands the handler platformDb (the BYPASSRLS connection), never a tenant-scoped client. */
export interface PlatformHandlerContext<TInput> {
  session: PlatformSessionUser;
  input: TInput;
  req: NextRequest;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public issues?: unknown) {
    super(message);
  }
}

export function definePlatformHandler<TSchema extends ZodType = ZodType<undefined>>(
  options: { input?: TSchema },
  fn: (ctx: PlatformHandlerContext<TSchema["_output"]>) => Promise<unknown>
) {
  return async (req: NextRequest) => {
    try {
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

      const result = await fn({ session: session.user, input, req });
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

export { platformDb };
