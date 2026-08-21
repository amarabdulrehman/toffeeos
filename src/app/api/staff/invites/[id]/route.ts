import { defineHandler } from "@/server/handler";

// DELETE /api/staff/invites/[id] — revoke a pending invite. The Invite model has no "revoked"
// state of its own (only accepted/expired), so revoking just deletes the row outright; the link
// stops resolving immediately since getInviteByToken can no longer find it.
export const DELETE = defineHandler(
  {
    permission: "staff.invite",
    audit: () => ({ action: "staff.invite.revoke", entityType: "Invite" }),
  },
  async ({ db, params }) => {
    await db.invite.delete({ where: { id: params.id } });
    return { ok: true };
  }
);
