import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvite } from "@/server/staff-invites";

const schema = z.object({
  name: z.string().min(2).max(120),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Public, unauthenticated — same reasoning as /api/signup: the account doesn't exist yet, so there
// is no session to gate this behind.
export async function POST(req: NextRequest, routeCtx: { params: Promise<{ token: string }> }) {
  const { token } = await routeCtx.params;
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await acceptInvite(token, parsed.data);
    if (!result) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 410 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not accept invite.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
