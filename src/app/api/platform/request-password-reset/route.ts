import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestPlatformPasswordReset } from "@/server/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

// Public, unauthenticated — deliberately NOT behind definePlatformHandler, since there's no
// session yet at this point. Same generic-response, no-enumeration contract as the tenant version.
const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`platform-password-reset-request:${ip}`, 5, 15 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests — please wait a while and try again." }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await requestPlatformPasswordReset(parsed.data.email);
  return NextResponse.json({ message: "If that account exists, we've sent a password reset link to its email." });
}
