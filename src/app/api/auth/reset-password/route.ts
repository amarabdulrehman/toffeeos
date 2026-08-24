import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/server/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/server/handler";

// Public, unauthenticated — shared by both the tenant and platform-admin flows. The token itself
// carries which one it is (PasswordResetToken.userType), so this one route/schema covers both.
const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`password-reset-confirm:${ip}`, 10, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts — please wait a while and try again." }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    await resetPassword(parsed.data.token, parsed.data.newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not reset password." }, { status: 500 });
  }
}
