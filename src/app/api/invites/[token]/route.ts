import { NextRequest, NextResponse } from "next/server";
import { getInviteByToken } from "@/server/staff-invites";

// Public, unauthenticated — the accept-invite page needs to show who/where this invite is for
// before the invitee has an account. No defineHandler here for the same reason /api/signup skips
// it: there's no session to resolve yet.
export async function GET(_req: NextRequest, routeCtx: { params: Promise<{ token: string }> }) {
  const { token } = await routeCtx.params;
  const invite = await getInviteByToken(token);
  if (!invite) {
    return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 404 });
  }
  return NextResponse.json(invite);
}
