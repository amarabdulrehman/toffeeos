import "server-only";
import crypto from "crypto";
import { addDays } from "date-fns";
import { platformDb, runInTenantTransaction } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/password";

const INVITE_EXPIRY_DAYS = 7;

export interface CreateInviteInput {
  branchId: string;
  roleId: string;
  email: string;
}

/** Owner/manager-side: mint a shareable, single-use link a staff member uses to set up their own
 * account. Nothing is emailed automatically (no email provider wired up yet, same as the rest of
 * this app's manual-share patterns — e.g. table QR codes) — the caller copies the link and sends
 * it themselves. */
export async function createInvite(tenantId: string, db: PrismaClient, input: CreateInviteInput) {
  const token = crypto.randomBytes(24).toString("base64url");
  return db.invite.create({
    data: {
      tenantId,
      branchId: input.branchId,
      roleId: input.roleId,
      email: input.email,
      token,
      expiresAt: addDays(new Date(), INVITE_EXPIRY_DAYS),
    },
  });
}

export interface PublicInvite {
  tenantName: string;
  tenantSlug: string;
  branchName: string;
  roleName: string;
  email: string | null;
}

/** Public lookup by token (accept-invite page, no session yet) — Invite is RLS-protected like any
 * other tenant-scoped table, so an RLS-bound connection with no app.tenant_id set can't see it at
 * all (that's not a bug to work around, it's the isolation working as designed); platformDb is the
 * one connection that can read across tenants, appropriate here because the unguessable token
 * itself is what authorizes this lookup, before we know which tenant it belongs to. Returns null
 * for a missing, expired, or already-accepted invite rather than distinguishing why, so the accept
 * page can't be used to enumerate which tokens once existed. */
export async function getInviteByToken(token: string): Promise<PublicInvite | null> {
  const invite = await platformDb.invite.findUnique({
    where: { token },
    include: { tenant: true, branch: true, role: true },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;

  return {
    tenantName: invite.tenant.name,
    tenantSlug: invite.tenant.slug,
    branchName: invite.branch.name,
    roleName: invite.role.name,
    email: invite.email,
  };
}

export interface AcceptInviteInput {
  name: string;
  password: string;
}

/** Public accept (no session yet). Creates the User + Membership inside the invite's tenant scope
 * and marks the invite consumed — re-checks expiry/acceptance inside the transaction in case two
 * accept requests raced on the same token. mustChangePassword is never set here: the invitee picks
 * their own password, same as self-serve signup, so there's nothing to force-change. */
export async function acceptInvite(
  token: string,
  input: AcceptInviteInput
): Promise<{ tenantId: string; tenantSlug: string; email: string } | null> {
  const invite = await platformDb.invite.findUnique({ where: { token }, include: { tenant: true } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date() || !invite.email) return null;

  const passwordHash = await hashPassword(input.password);
  const userId = newId();

  await runInTenantTransaction(invite.tenantId, async (tx) => {
    const fresh = await tx.invite.findUniqueOrThrow({ where: { id: invite.id } });
    if (fresh.acceptedAt) throw new Error("This invite has already been used.");

    await tx.user.create({
      data: {
        id: userId,
        tenantId: invite.tenantId,
        name: input.name,
        email: invite.email,
        passwordHash,
        isActive: true,
      },
    });

    await tx.membership.create({
      data: { tenantId: invite.tenantId, userId, branchId: invite.branchId, roleId: invite.roleId, isActive: true },
    });

    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  });

  return { tenantId: invite.tenantId, tenantSlug: invite.tenant.slug, email: invite.email };
}
